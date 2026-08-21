/**
 * IELTS Auto-Checker
 * Handles exact matches, optional words in ( ), and alternate answers with /
 */
function checkIeltsAnswer(studentAnswer, officialAnswer) {
  // 1. Basic cleanup: Convert to lowercase, remove extra spaces around and inside
  const student = studentAnswer.toLowerCase().trim().replace(/\s+/g, ' ');
  const official = officialAnswer.toLowerCase().trim().replace(/\s+/g, ' ');

  // 2. Direct Match (Agar exactly match ho gaya bina kisi jhanjhat ke)
  if (student === official) return true;

  // 3. Handle Slashes '/' (e.g., "car / auto")
  if (official.includes('/')) {
    const validOptions = official.split('/').map(opt => opt.trim());
    // Check if student answer matches any option before or after slash
    for (let option of validOptions) {
        // Recursively check each option in case it also has brackets
        if (checkIeltsAnswer(student, option)) return true;
    }
  }

  // 4. Handle Brackets '()' (e.g., "fermentation (process)")
  if (official.includes('(') && official.includes(')')) {
    
    // Variation A: Bachhe ne bracket wala word BHI likha hai 
    // (Remove the brackets but keep the word -> "fermentation process")
    const withOptionalWord = official.replace(/[()]/g, '').replace(/\s+/g, ' ').trim();
    
    // Variation B: Bachhe ne bracket wala word NAHI likha hai 
    // (Remove the brackets AND the word inside -> "fermentation")
    const withoutOptionalWord = official.replace(/\(.*?\)/g, '').replace(/\s+/g, ' ').trim();

    if (student === withOptionalWord || student === withoutOptionalWord) {
      return true;
    }
  }

  // Agar upar me se kuch match nahi hua, toh aakhiri rasta false hai
  return false;
}

module.exports = { checkIeltsAnswer };

// ==========================================
// 🧪 TESTING THE LOGIC (Tu khud dekh le)
// ==========================================

// const officialAns = "fermentation (process)";

// console.log(checkIeltsAnswer("fermentation process", officialAns)); // ✅ true
// console.log(checkIeltsAnswer("fermentation", officialAns));         // ✅ true
// console.log(checkIeltsAnswer("  Fermentation   ", officialAns));    // ✅ true (handles spaces & caps)
// console.log(checkIeltsAnswer("fermentation method", officialAns));  // ❌ false (wrong word)

// const officialAns2 = "(the) price";
// console.log(checkIeltsAnswer("the price", officialAns2));           // ✅ true
// console.log(checkIeltsAnswer("price", officialAns2));               // ✅ true

// const officialAns3 = "wood/charcoal";
// console.log(checkIeltsAnswer("wood", officialAns3));                // ✅ true
// console.log(checkIeltsAnswer("charcoal", officialAns3));            // ✅ true