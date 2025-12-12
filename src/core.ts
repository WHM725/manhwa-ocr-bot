import { createCanvas, loadImage, CanvasRenderingContext2D } from 'canvas';
import { Client } from '@google/genai';

// --- 1. Text Formatting ---
export enum TextBlockCategory {
  SPEECH = 'speech', THOUGHT = 'thought', BOX = 'box', NARRATION = 'narration',
  SMALL_TEXT = 'small_text', SFX = 'SFX', SYSTEM = 'system', SCREAM = 'scream', LINKED = 'linked',
}

const formatText = (text: string, category: TextBlockCategory): string => {
  const t = text.trim();
  switch (category) {
    case TextBlockCategory.SPEECH: return `“”: ${t}`;
    case TextBlockCategory.THOUGHT: return `(): ${t}`;
    case TextBlockCategory.BOX: return `[]: ${t}`;
    case TextBlockCategory.NARRATION: return `OT: ${t}`;
    case TextBlockCategory.SMALL_TEXT: return `ST: ${t}`;
    case TextBlockCategory.SYSTEM: return `{}: ${t}`;
    case TextBlockCategory.SCREAM: return `:: ${t}`;
    case TextBlockCategory.LINKED: return `//: ${t}`;
    case TextBlockCategory.SFX: return `SFX: ${t}`;
    default: return t;
  }
};

// --- 2. Smart Slicing (Pixel Scanning) ---
const findBestCutPosition = (ctx: CanvasRenderingContext2D, width: number, currentY: number, maxH: number, minH: number): number => {
  const remaining = ctx.canvas.height - currentY;
  if (remaining <= maxH) return remaining;

  const startScan = minH;
  const endScan = maxH;
  const scanH = endScan - startScan;
  const imgData = ctx.getImageData(0, currentY + startScan, width, scanH);
  const data = imgData.data;
  
  let bestY = endScan;
  let minEnergy = Number.MAX_VALUE;

  for (let y = 0; y < scanH; y += 4) { // Scan every 4th row for speed
    let rowEnergy = 0;
    for (let x = 0; x < width; x += 10) { // Scan every 10th pixel
      const idx = (y * width + x) * 4;
      const r = data[idx], g = data[idx+1], b = data[idx+2];
      const distWhite = Math.abs(255-r) + Math.abs(255-g) + Math.abs(255-b);
      const distBlack = r + g + b;
      rowEnergy += Math.min(distWhite, distBlack);
    }
    const penalty = (scanH - y) * 0.2; 
    const finalScore = (rowEnergy / (width/10)) + penalty;
    if (finalScore < minEnergy) { minEnergy = finalScore; bestY = startScan + y; }
  }
  return bestY;
};

// --- 3. Multi-Key Processor ---
export const processManhwa = async (imageUrl: string, apiKeys: string[]): Promise<string> => {
  // A. Load & Slice
  const image = await loadImage(imageUrl);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);

  const slices: string[] = [];
  let currentY = 0;
  const MAX_SLICE = 3000;
  const MIN_SLICE = 1500;

  while (currentY < image.height) {
    const sliceH = findBestCutPosition(ctx, image.width, currentY, MAX_SLICE, MIN_SLICE);
    const sCanvas = createCanvas(image.width, sliceH);
    sCanvas.getContext('2d').drawImage(canvas, 0, currentY, image.width, sliceH, 0, 0, image.width, sliceH);
    slices.push(sCanvas.toDataURL('image/jpeg', 0.85).split(',')[1]);
    currentY += sliceH;
  }

  // B. Process Slices with Key Rotation
  const allBlocks: any[] = [];

  for (let i = 0; i < slices.length; i++) {
    let success = false;
    let attempts = 0;
    
    // FAILOVER LOOP: Try keys until one works
    while (!success && attempts < apiKeys.length) {
      // Round Robin Selection: (Slice Index + Attempts) % Total Keys
      // This ensures we spread load evenly across all keys
      const keyIndex = (i + attempts) % apiKeys.length;
      const currentKey = apiKeys[keyIndex];
      const client = new Client({ apiKey: currentKey });

      try {
        const response = await client.models.generateContent({
          model: 'gemini-1.5-flash', // Fastest & Free-est
          contents: [{
            parts: [
              { text: `Extract text. JSON Array ONLY. Fields: text, category (speech, thought, box, narration, small_text, sfx, system, scream, linked). Ignore generic SFX.` },
              { inlineData: { mimeType: 'image/jpeg', data: slices[i] } }
            ]
          }]
        });
        
        const txt = response.text ? response.text() : "[]";
        const jsonStr = txt.replace(/```json|```/g, '').trim();
        const blocks = JSON.parse(jsonStr);
        if (Array.isArray(blocks)) allBlocks.push(...blocks);
        
        success = true; // Success! Exit retry loop

      } catch (e) {
        // Log failure but don't crash
        console.warn(`⚠️ Key ending in ...${currentKey.slice(-4)} failed on Slice ${i+1}. Switching keys...`);
        attempts++;
      }
    }
    
    if (!success) console.error(`❌ Slice ${i+1} failed with all keys.`);
  }

  // C. Format Output
  let output = "";
  allBlocks.forEach(b => {
    output += formatText(b.text || "", b.category || TextBlockCategory.SPEECH) + "\n";
  });
  return output;
};