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

const preprocess = (source: string, region?: OcrRegion) => new Promise<string>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
        const sourceX = region ? Math.max(0, Math.round(region.x * image.naturalWidth)) : 0;
        const sourceY = region ? Math.max(0, Math.round(region.y * image.naturalHeight)) : 0;
        const sourceWidth = region ? Math.max(1, Math.round(region.width * image.naturalWidth)) : image.naturalWidth;
        const sourceHeight = region ? Math.max(1, Math.round(region.height * image.naturalHeight)) : image.naturalHeight;
        const scale = Math.min(3, 2400 / Math.max(sourceWidth, sourceHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(sourceWidth * scale));
        canvas.height = Math.max(1, Math.round(sourceHeight * scale));
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) return reject(new Error('Your browser could not prepare the screenshot.'));
        context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
        for (let index = 0; index < pixels.data.length; index += 4) {
            const luminance = pixels.data[index] * 0.299 + pixels.data[index + 1] * 0.587 + pixels.data[index + 2] * 0.114;
            const boosted = Math.max(0, Math.min(255, (luminance - 128) * 1.8 + 150));
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
    type: { x: 0.16, y: 0.16, width: 0.68, height: 0.10 },
    title: { x: 0.22, y: 0.285, width: 0.70, height: 0.055 },
    level: { x: 0.055, y: 0.305, width: 0.22, height: 0.09 },
    details: { x: 0.20, y: 0.315, width: 0.72, height: 0.12 },
};

export async function recognizeImportCardLocally(imageDataUrl: string, onProgress: (message: OcrProgress) => void) {
    const tesseract = await loadTesseract();
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
            await worker.setParameters({ tessedit_pageseg_mode: field === 'title' || field === 'level' ? '7' : '6' });
            const response = await worker.recognize(await preprocess(imageDataUrl, MOBILE_IMPORT_REGIONS[field]));
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
