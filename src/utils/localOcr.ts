export type OcrProgress = { status: string; progress: number };

type TesseractResult = { data: { text: string; confidence: number } };
type TesseractWorker = { recognize(image: string): Promise<TesseractResult>; terminate(): Promise<void> };
type TesseractApi = { createWorker(language: string, oem?: number, options?: { logger?: (message: OcrProgress) => void }): Promise<TesseractWorker> };

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

const preprocess = (source: string) => new Promise<string>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
        const scale = Math.min(2, 1800 / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) return reject(new Error('Your browser could not prepare the screenshot.'));
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
        for (let index = 0; index < pixels.data.length; index += 4) {
            const luminance = pixels.data[index] * 0.299 + pixels.data[index + 1] * 0.587 + pixels.data[index + 2] * 0.114;
            const boosted = luminance > 165 ? 255 : luminance < 80 ? 0 : Math.max(0, Math.min(255, (luminance - 80) * 3));
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

export async function recognizeLocally(imageDataUrl: string, onProgress: (message: OcrProgress) => void) {
    const prepared = await preprocess(imageDataUrl);
    const tesseract = await loadTesseract();
    const worker = await tesseract.createWorker('eng', 1, { logger: onProgress });
    try {
        const response = await worker.recognize(prepared);
        return { text: response.data.text, confidence: Math.max(0, Math.min(1, response.data.confidence / 100)) };
    } finally {
        await worker.terminate();
    }
}

