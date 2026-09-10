export type OcrProgress = { status: string; progress: number };

type TesseractResult = { data: { text: string; confidence: number } };
type TesseractWorker = {
    recognize(image: string): Promise<TesseractResult>;
    setParameters(parameters: Record<string, string>): Promise<void>;
    terminate(): Promise<void>;
};
type TesseractApi = { createWorker(language: string, oem?: number, options?: { logger?: (message: OcrProgress) => void }): Promise<TesseractWorker> };

export type OcrRegion = { x: number; y: number; width: number; height: number };

declare global {
    interface Window { Tesseract?: TesseractApi }
}

let loader: Promise<TesseractApi> | null = null;

const loadTesseract = () => {
    if (window.Tesseract) return Promise.resolve(window.Tesseract);
    if (loader) return loader;
    loader = new Promise<TesseractApi>((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js';
        script.async = true;
        script.crossOrigin = 'anonymous';
        script.onload = () => window.Tesseract ? resolve(window.Tesseract) : reject(new Error('The local OCR engine did not start.'));
        script.onerror = () => reject(new Error('The local OCR engine could not be downloaded. Check your connection and try again.'));
        document.head.appendChild(script);
    });
    return loader;
};

type PreprocessMode = 'contrast' | 'document';

const preprocess = (source: string, region?: OcrRegion, mode: PreprocessMode = 'contrast') => new Promise<string>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
        const sourceX = region ? Math.max(0, Math.round(region.x * image.naturalWidth)) : 0;
        const sourceY = region ? Math.max(0, Math.round(region.y * image.naturalHeight)) : 0;
        const sourceWidth = region ? Math.max(1, Math.round(region.width * image.naturalWidth)) : image.naturalWidth;
        const sourceHeight = region ? Math.max(1, Math.round(region.height * image.naturalHeight)) : image.naturalHeight;
        const scale = Math.min(region && region.height <= 0.05 ? 4 : 3, 3000 / Math.max(sourceWidth, sourceHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(sourceWidth * scale));
        canvas.height = Math.max(1, Math.round(sourceHeight * scale));
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) return reject(new Error('Your browser could not prepare the screenshot.'));
        context.imageSmoothingEnabled = mode !== 'document';
        context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
        for (let index = 0; index < pixels.data.length; index += 4) {
            const luminance = pixels.data[index] * 0.299 + pixels.data[index + 1] * 0.587 + pixels.data[index + 2] * 0.114;
            // The game renders secondary stats in medium gray and titles with a
            // colored fill plus a black outline. A document threshold preserves
            // both of those against the white card; the older contrast-only pass
            // could wash the gray lines into the background on high-res phones.
            const boosted = mode === 'document'
                ? (luminance >= 208 ? 255 : 0)
                : Math.max(0, Math.min(255, (luminance - 128) * 1.8 + 150));
            pixels.data[index] = boosted;
            pixels.data[index + 1] = boosted;
            pixels.data[index + 2] = boosted;
        }
        context.putImageData(pixels, 0, 0);
        resolve(canvas.toDataURL('image/png'));
    };
    image.onerror = () => reject(new Error('The screenshot could not be opened.'));
    image.src = source;
});

export async function recognizeLocally(imageDataUrl: string, onProgress: (message: OcrProgress) => void, region?: OcrRegion) {
    const prepared = await preprocess(imageDataUrl, region);
    const tesseract = await loadTesseract();
    const worker = await tesseract.createWorker('eng', 1, { logger: onProgress });
    try {
        const response = await worker.recognize(prepared);
        return { text: response.data.text, confidence: Math.max(0, Math.min(1, response.data.confidence / 100)) };
    } finally {
        await worker.terminate();
    }
}

// Derived from the common portrait pet/mount detail-card screenshots. The focused
// pass excludes the dimmed inventory and oversized action buttons that otherwise
// compete with the name, level, base stats, and substats.
export const MOBILE_COMPANION_CARD_REGION: OcrRegion = {
    x: 0.055,
    y: 0.285,
    width: 0.89,
    height: 0.19,
};

export type ImportCardOcrFields = {
    type: string;
    title: string;
    level: string;
    details: string;
};

// These regions deliberately separate the dimmed Pets/Mounts heading, the
// "[Rarity] Name" title, the icon-side level, and the numeric detail lines.
// Keeping their text apart prevents unrelated screen text from becoming fields.
export const MOBILE_IMPORT_REGIONS: Record<keyof ImportCardOcrFields, OcrRegion> = {
    type: { x: 0.34, y: 0.070, width: 0.32, height: 0.040 },
    title: { x: 0.285, y: 0.305, width: 0.64, height: 0.030 },
    level: { x: 0.075, y: 0.350, width: 0.18, height: 0.035 },
    // Intentionally includes the title and level as fallbacks. Parsing filters
    // this broad card crop down to known names and recognized stat lines.
    details: { x: 0.285, y: 0.305, width: 0.64, height: 0.115 },
};

// Each visible value sits on its own baseline. Tesseract is substantially more
// reliable on this outlined game font when each baseline is read as one line.
const locateCardTop = (source: string) => new Promise<number>(resolve => {
    const image = new Image();
    image.onload = () => {
        const canvas = document.createElement('canvas');
        const sampleWidth = 240;
        canvas.width = sampleWidth;
        canvas.height = Math.max(1, Math.round(sampleWidth * image.naturalHeight / image.naturalWidth));
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) return resolve(MOBILE_COMPANION_CARD_REGION.y);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        const startX = Math.round(canvas.width * 0.06);
        const endX = Math.round(canvas.width * 0.94);
        let streak = 0;
        for (let y = Math.round(canvas.height * 0.18); y < Math.round(canvas.height * 0.72); y += 1) {
            let bright = 0;
            for (let x = startX; x < endX; x += 2) {
                const index = (y * canvas.width + x) * 4;
                const luminance = pixels[index] * 0.299 + pixels[index + 1] * 0.587 + pixels[index + 2] * 0.114;
                if (luminance >= 235) bright += 1;
            }
            const ratio = bright / Math.ceil((endX - startX) / 2);
            streak = ratio >= 0.72 ? streak + 1 : 0;
            if (streak >= 4) return resolve(Math.max(0, (y - streak + 1) / canvas.height));
        }
        resolve(MOBILE_COMPANION_CARD_REGION.y);
    };
    image.onerror = () => resolve(MOBILE_COMPANION_CARD_REGION.y);
    image.src = source;
});

export async function recognizeImportCardLocally(imageDataUrl: string, onProgress: (message: OcrProgress) => void) {
    const tesseract = await loadTesseract();
    const cardTop = await locateCardTop(imageDataUrl);
    const regions: Record<keyof ImportCardOcrFields, OcrRegion> = {
        type: MOBILE_IMPORT_REGIONS.type,
        title: { x: 0.285, y: cardTop + 0.027, width: 0.64, height: 0.035 },
        level: { x: 0.075, y: cardTop + 0.078, width: 0.18, height: 0.040 },
        details: { x: 0.285, y: cardTop + 0.025, width: 0.64, height: 0.145 },
    };
    const statLineRegions: OcrRegion[] = [
        { x: 0.285, y: cardTop + 0.096, width: 0.60, height: 0.030 },
        { x: 0.285, y: cardTop + 0.116, width: 0.60, height: 0.030 },
    ];
    const fieldNames = Object.keys(MOBILE_IMPORT_REGIONS) as (keyof ImportCardOcrFields)[];
    let passIndex = 0;
    const worker = await tesseract.createWorker('eng', 1, {
        logger: message => onProgress({
            ...message,
            status: `reading ${fieldNames[passIndex] || 'card'} field`,
            progress: (passIndex + (message.progress || 0)) / fieldNames.length,
        }),
    });
    try {
        const fields = {} as ImportCardOcrFields;
        const confidences: number[] = [];
        for (passIndex = 0; passIndex < fieldNames.length; passIndex += 1) {
            const field = fieldNames[passIndex];
            if (field === 'details') {
                const lines: string[] = [];
                for (const region of statLineRegions) {
                    await worker.setParameters({ tessedit_pageseg_mode: '7', tessedit_char_whitelist: '0123456789.,+-%' });
                    const valueResponse = await worker.recognize(await preprocess(imageDataUrl, { ...region, width: 0.17 }, 'document'));
                    await worker.setParameters({ tessedit_pageseg_mode: '7', tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz ' });
                    const nameResponse = await worker.recognize(await preprocess(imageDataUrl, { ...region, x: 0.39, width: 0.49 }, 'document'));
                    const line = `${valueResponse.data.text.trim()} ${nameResponse.data.text.trim()}`.trim();
                    if (line) lines.push(line);
                    confidences.push(valueResponse.data.confidence, nameResponse.data.confidence);
                }
                await worker.setParameters({ tessedit_char_whitelist: '' });
                fields.details = lines.join('\n');
                continue;
            }
            await worker.setParameters({
                tessedit_pageseg_mode: field === 'title' || field === 'level' ? '7' : '6',
                tessedit_char_whitelist: field === 'level' ? '0123456789Lv.' : '',
            });
            const response = await worker.recognize(await preprocess(
                imageDataUrl,
                regions[field],
                'contrast',
            ));
            fields[field] = response.data.text.trim();
            confidences.push(response.data.confidence);
        }
        onProgress({ status: 'validating known game values', progress: 1 });
        return {
            text: Object.values(fields).join('\n').trim(),
            fields,
            confidence: Math.max(0, Math.min(1, Math.max(...confidences) / 100)),
        };
    } finally {
        await worker.terminate();
    }
}

export async function recognizeRegionsLocally(imageDataUrl: string, regions: OcrRegion[], onProgress: (message: OcrProgress) => void) {
    if (!regions.length) return [];
    const tesseract = await loadTesseract();
    const worker = await tesseract.createWorker('eng', 1, { logger: onProgress });
    try {
        const results: { text: string; confidence: number }[] = [];
        for (const region of regions) {
            const prepared = await preprocess(imageDataUrl, region);
            const response = await worker.recognize(prepared);
            results.push({
                text: response.data.text.trim(),
                confidence: Math.max(0, Math.min(1, response.data.confidence / 100)),
            });
        }
        return results;
    } finally {
        await worker.terminate();
    }
}
