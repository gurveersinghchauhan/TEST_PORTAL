const pdfLib = require('pdf-parse');
const { GoogleGenerativeAI } = require('@google/generative-ai');

/**
 * pdfParserService.js (AI POWERED with Fallback & Safety Net)
 * --------------------
 * PDF -> raw text -> Gemini AI -> Structured Test JSON.
 */

/* ---------------------------------------------------------------------- */
/* 1. Raw text extraction (Bulletproof version)                           */
/* ---------------------------------------------------------------------- */
async function extractRawText(buffer) {
  try {
    let rawText = '';
    if (pdfLib.PDFParse) {
      const parser = new pdfLib.PDFParse({ data: buffer });
      const result = await parser.getText();
      await parser.destroy(); 
      rawText = result.text;
    } else if (typeof pdfLib === 'function') {
      const data = await pdfLib(buffer);
      rawText = data.text;
    } else {
      const parseFn = pdfLib.default || pdfLib;
      const data = await parseFn(buffer);
      rawText = data.text;
    }
    return rawText.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n');
  } catch (error) {
    console.error("❌ PDF extraction failed inside pdf-parse:", error);
    throw error;
  }
}

/* ---------------------------------------------------------------------- */
/* 2. AI Fallback Orchestrator                                            */
/* ---------------------------------------------------------------------- */
async function callGeminiWithFallback(genAI, prompt) {
  // Smart model ko priority par rakha hai taaki lamba text kate nahi
  const modelsToTry = [
    "gemini-1.5-flash",
    "gemini-1.5-flash-8b",
    "gemini-flash-lite-latest"
  ];

  for (const modelName of modelsToTry) {
    try {
      console.log(`👉 Trying model: ${modelName}...`);
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent(prompt);
      return result.response.text();
    } catch (err) {
      console.warn(`⚠️ ${modelName} failed, switching to next model...`);
    }
  }
  throw new Error("All fallback models exhausted or unavailable.");
}

/* ---------------------------------------------------------------------- */
/* 3. Main PDF Parser Function                                            */
/* ---------------------------------------------------------------------- */
async function parseReadingTestPdf(pdfBuffer) {
  // GEMINI_API_KEY is optional at the app level (see server.js) — teachers
  // currently use an external AI workflow and paste JSON directly instead
  // (POST /api/tests), so this path is allowed to be unavailable rather than
  // required. Checked first, before spending time extracting PDF text or
  // constructing a client with an undefined key, so the failure is fast and
  // the message is unambiguous rather than surfacing as an opaque SDK error.
  if (!process.env.GEMINI_API_KEY) {
    const err = new Error('AI PDF import is currently unavailable.');
    err.code = 'GEMINI_UNAVAILABLE';
    throw err;
  }

  console.log("👉 Step 1: Extracting raw text from PDF...");
  const rawText = await extractRawText(pdfBuffer);
  
  console.log("👉 Step 2: Sending text to Gemini AI for intelligent parsing...");
  
  // API key server.js se utha raha hai
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  
  const prompt = `
  You are an expert language test parser. I will provide you with the raw text extracted from a Reading Test PDF.
  Your job is to read the text, understand the layout (Passages, Questions, Answer Keys), and convert it into a strictly formatted JSON object.

  CRITICAL RULES:
  1. Fix any broken paragraphs or sentences that were split across columns in the PDF.
  2. Keep the passage text well-formatted with double line breaks (\\n\\n) between paragraphs.
  3. Extract all questions and accurately identify their types.
  4. If there is an Answer Key at the end of the text, map the correct answers to the corresponding questions.
  5. Return ONLY valid JSON. Do not include markdown tags like \`\`\`json or \`\`\`.
  6. ABSOLUTELY DO NOT TRUNCATE OR OMIT ANY TEXT. You MUST extract and include the FULL text of all Reading Passages and ALL questions. Do not use placeholders.

  Expected JSON format:
  {
    "title": "Extracted Test Title (or 'Untitled Reading Test')",
    "module": "reading",
    "durationMinutes": 60,
    "totalQuestions": 40,
    "parts": [
      {
        "partNumber": 1,
        "title": "Title of the Passage",
        "instructions": "Read the text and answer the questions.",
        "passageText": "Full text of passage. Fix broken lines. Use \\n\\n for paragraphs.",
        "questionGroups": [
          {
            "groupInstructions": "Choose TRUE, FALSE or NOT GIVEN...",
            "questionType": "true-false-not-given",
            "startNumber": 1,
            "endNumber": 3,
            "questions": [
              {
                "questionNumber": 1,
                "type": "true-false-not-given",
                "prompt": "The actual question text",
                "options": [],
                "correctAnswer": "TRUE" 
              }
            ]
          }
        ]
      }
    ],
    "unmatchedAnswerNumbers": []
  }

  Raw PDF Text:
  ${rawText}
  `;

  try {
    let aiText = await callGeminiWithFallback(genAI, prompt);

    console.log("👉 Step 3: AI response received, cleaning up JSON...");
    
    // Clean up markdown formatting
    aiText = aiText.replace(/```json/g, '').replace(/```/g, '').trim();

    const parsedData = JSON.parse(aiText);

    // 🛑 SAFETY NET: Agar AI ne aalas kiya aur passage khali chhod diya
    if (!parsedData.parts || parsedData.parts.length === 0 || !parsedData.parts[0].passageText || parsedData.parts[0].passageText.trim() === '') {
      console.log("⚠️ AI was lazy and returned empty parts. Injecting raw text manually.");
      parsedData.parts = [{
        partNumber: 1,
        title: 'Raw Passage (AI Formatter Skipped)',
        instructions: 'Please format the paragraphs and add questions manually.',
        passageText: rawText, // Zabardasti raw text daal rahe hain
        questionGroups: []
      }];
    }

    console.log("✅ AI Parsing successful!");
    return parsedData;

  } catch (error) {
    console.error("❌ AI Parsing failed, falling back to manual dump:", error);
    return {
      title: 'Manual Draft (AI Failed)',
      module: 'reading',
      durationMinutes: 60,
      totalQuestions: 0,
      parts: [{
        partNumber: 1,
        title: 'Raw Text Dump',
        instructions: 'AI parsing failed. Please format manually.',
        passageText: rawText,
        questionGroups: []
      }],
      unmatchedAnswerNumbers: []
    };
  }
}

module.exports = {
  parseReadingTestPdf,
  extractRawText
};