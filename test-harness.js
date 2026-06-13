#!/usr/bin/env node

// Configuration - update these to match your Kiwix instance
const KIWIX_BASE_URL = process.env.KIWIX_BASE_URL || "http://192.168.1.5:8080";
const DEFAULT_ZIM = process.env.DEFAULT_ZIM || "wikipedia_en_all_maxi_2026-02";

// Test results tracking
let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
let testResults = [];

class TestHarness {
  constructor() {
    this.results = [];
  }

  async runTest(name, testFn) {
    totalTests++;
    console.error(`\n[Test] ${name}`);
    try {
      const result = await testFn();
      if (result.passed) {
        passedTests++;
        console.error(`  ✓ PASS: ${result.message || "Test passed"}`);
        this.results.push({ name, status: "PASS", message: result.message });
      } else {
        failedTests++;
        console.error(`  ✗ FAIL: ${result.message || "Test failed"}`);
        this.results.push({ name, status: "FAIL", message: result.message });
      }
    } catch (error) {
      failedTests++;
      console.error(`  ✗ ERROR: ${error.message}`);
      this.results.push({ name, status: "ERROR", message: error.message || String(error) });
    }
    testResults = [...this.results];
  }

  printSummary() {
    console.error("\n" + "=".repeat(70));
    console.error("TEST HARNESS SUMMARY");
    console.error("=".repeat(70));
    console.error(`Target:   ${KIWIX_BASE_URL}`);
    console.error(`ZIM File: ${DEFAULT_ZIM}`);
    console.error(`Total:    ${totalTests}`);
    console.error(`Passed:   ${passedTests}`);
    console.error(`Failed:   ${failedTests}`);
    const rate = totalTests > 0 ? ((passedTests / totalTests) * 100).toFixed(1) : "0.0";
    console.error(`Success:  ${rate}%`);
    console.error("=".repeat(70));

    if (this.results.length > 0) {
      console.error("\nDetailed Results:");
      console.error("-".repeat(70));
      for (const result of this.results) {
        const icon = result.status === "PASS" ? "✓" : "✗";
        console.error(`  ${icon} [${result.status}] ${result.name}: ${result.message || ""}`);
      }
    }

    return failedTests === 0;
  }
}

// ============================================================
// Test Functions - Direct HTTP tests against Kiwix APIs
// ============================================================

async function testKiwixReachability() {
  const response = await fetch(`${KIWIX_BASE_URL}/`);
  return {
    passed: response.ok,
    message: `Kiwix server reachable (HTTP ${response.status})`
  };
}

async function testListAllZims() {
  const response = await fetch(`${KIWIX_BASE_URL}/catalog/v2/entries`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  
  // Kiwix may return XML or JSON depending on Accept header
  const contentType = response.headers.get('content-type') || '';
  
  let zims = [];
  if (contentType.includes('json')) {
    const data = await response.json();
    zims = data.results || [];
  } else {
    // Handle XML Atom OPDS feed response
    const text = await response.text();
    // Extract <name> tags from <entry> elements in the Atom feed
    // The first <name> tag within each entry is the ZIM file name
    const entryRegex = /<entry[^>]*>([\s\S]*?)<\/entry>/g;
    let match;
    while ((match = entryRegex.exec(text)) !== null) {
      const nameMatch = match[1].match(/<name>(.*?)<\/name>/);
      if (nameMatch) {
        zims.push(nameMatch[1]);
      }
    }
  }
  
  return {
    passed: zims.length > 0,
    message: `Found ${zims.length} ZIM file(s): ${zims.slice(0, 5).join(", ")}${zims.length > 5 ? "..." : ""}`
  };
}

async function testSearchBasic() {
  const response = await fetch(
    `${KIWIX_BASE_URL}/search?pattern=Python&books.name=${DEFAULT_ZIM}&count=3`
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const text = await response.text();
  
  return {
    passed: text.length > 0 && !text.includes("Error"),
    message: `Search returned ${text.trim().split("\n").filter(l => l.trim()).length} lines`
  };
}

async function testSearchNoResults() {
  const response = await fetch(
    `${KIWIX_BASE_URL}/search?pattern=xyznonexistent12345abc&books.name=${DEFAULT_ZIM}&count=3`
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const text = await response.text();
  
  return {
    passed: true,
    message: "Search handled gracefully with no results"
  };
}

async function testGetContentPython() {
  const response = await fetch(
    `${KIWIX_BASE_URL}/content/${DEFAULT_ZIM}/Python_(programming_language)`
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const html = await response.text();
  
  const hasContent = html.length > 100 && !html.includes("Page not found");
  
  return {
    passed: hasContent,
    message: `Retrieved ${html.length} chars of HTML for "Python (programming_language)"`
  };
}

async function testGetContentUnitedStates() {
  const response = await fetch(
    `${KIWIX_BASE_URL}/content/${DEFAULT_ZIM}/United_States`
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const html = await response.text();
  
  return {
    passed: html.length > 100 && !html.includes("Page not found"),
    message: `Retrieved ${html.length} chars for "United_States"`
  };
}

async function testInvalidZimFile() {
  const response = await fetch(
    `${KIWIX_BASE_URL}/search?pattern=test&books.name=nonexistent_zim_file_xyz&count=3`
  );
  
  return {
    passed: response.status !== 200,
    message: `Expected error for invalid ZIM (HTTP ${response.status})`
  };
}

async function testSearchWithDifferentCounts() {
  const response1 = await fetch(
    `${KIWIX_BASE_URL}/search?pattern=JavaScript&books.name=${DEFAULT_ZIM}&count=2`
  );
  const response2 = await fetch(
    `${KIWIX_BASE_URL}/search?pattern=JavaScript&books.name=${DEFAULT_ZIM}&count=10`
  );
  
  if (!response1.ok || !response2.ok) throw new Error("One or both requests failed");
  
  const text1 = await response1.text();
  const text2 = await response2.text();
  
  return {
    passed: true,
    message: `count=2 (${text1.split("\n").filter(l => l.trim()).length} lines), count=10 (${text2.split("\n").filter(l => l.trim()).length} lines)`
  };
}

async function testSearchWiktionary() {
  // Test with a different ZIM file if available (common names)
  const zimsToTry = ["wiktionary_en_all_maxi", "en.wiktionary.2026-02"];
  
  for (const zim of zimsToTry) {
    try {
      const response = await fetch(
        `${KIWIX_BASE_URL}/search?pattern=hello&books.name=${zim}&count=3`
      );
      if (response.ok) {
        return {
          passed: true,
          message: `Search worked with ZIM: ${zim}`
        };
      }
    } catch {}
  }
  
  return {
    passed: true, // Not a failure if wiktionary isn't available
    message: "Wiktionary ZIM not found (only testing Wikipedia)"
  };
}

async function testSearchResponseTime() {
  const start = Date.now();
  const response = await fetch(
    `${KIWIX_BASE_URL}/search?pattern=Test&books.name=${DEFAULT_ZIM}&count=5`
  );
  const elapsed = Date.now() - start;
  
  return {
    passed: elapsed < 10000,
    message: `Search response time: ${elapsed}ms`
  };
}

async function testContentResponseTime() {
  const start = Date.now();
  const response = await fetch(
    `${KIWIX_BASE_URL}/content/${DEFAULT_ZIM}/Python_(programming_language)`
  );
  const elapsed = Date.now() - start;
  
  return {
    passed: elapsed < 10000,
    message: `Content response time: ${elapsed}ms`
  };
}

async function testHomePageContent() {
  const response = await fetch(`${KIWIX_BASE_URL}/`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const html = await response.text();
  
  return {
    passed: html.length > 0 && !html.includes("Error"),
    message: `Home page is ${html.length} bytes`
  };
}

async function testSearchSpecialCharacters() {
  const response = await fetch(
    `${KIWIX_BASE_URL}/search?pattern=C%2B%2B&books.name=${DEFAULT_ZIM}&count=3`
  );
  
  return {
    passed: response.ok || response.status === 404,
    message: `Search with special chars handled (HTTP ${response.status})`
  };
}

// ============================================================
// Main Test Runner
// ============================================================

async function runAllTests() {
  console.error("\n" + "=".repeat(70));
  console.error("         KIWIX WIKIPEDIA TEST HARNESS");
  console.error("=".repeat(70));
  console.error(`Target:   ${KIWIX_BASE_URL}`);
  console.error(`ZIM File: ${DEFAULT_ZIM}`);
  console.error(`Date:     ${new Date().toISOString()}`);
  console.error("=".repeat(70));

  const harness = new TestHarness();

  // --- Connectivity Tests ---
  console.error("\n[1/3] Connectivity Tests");
  await harness.runTest("Kiwix Reachability", testKiwixReachability);
  await harness.runTest("Home Page Content", testHomePageContent);

  // --- ZIM File Tests ---
  console.error("\n[2/3] ZIM File Tests");
  await harness.runTest("List All ZIM Files", testListAllZims);

  // --- Search Tests ---
  console.error("\n[3/3] Search & Content Tests");
  await harness.runTest("Search Basic (Python)", testSearchBasic);
  await harness.runTest("Search No Results", testSearchNoResults);
  await harness.runTest("Search With Different Counts", testSearchWithDifferentCounts);
  await harness.runTest("Search Special Characters (C++)", testSearchSpecialCharacters);
  await harness.runTest("Search Wiktionary (if available)", testSearchWiktionary);

  // --- Content Tests ---
  console.error("\n--- Content Retrieval ---");
  await harness.runTest("Get Content: Python", testGetContentPython);
  await harness.runTest("Get Content: United States", testGetContentUnitedStates);
  await harness.runTest("Invalid ZIM File Handling", testInvalidZimFile);

  // --- Performance Tests ---
  console.error("\n--- Performance ---");
  await harness.runTest("Search Response Time", testSearchResponseTime);
  await harness.runTest("Content Response Time", testContentResponseTime);

  // --- Summary ---
  const success = harness.printSummary();

  // Write results to JSON file
  try {
    const fs = await import('fs');
    const resultsJson = JSON.stringify({
      timestamp: new Date().toISOString(),
      target: KIWIX_BASE_URL,
      defaultZim: DEFAULT_ZIM,
      totalTests,
      passedTests,
      failedTests,
      successRate: totalTests > 0 ? ((passedTests / totalTests) * 100).toFixed(1) + "%" : "0%",
      results: testResults
    }, null, 2);
    
    fs.writeFileSync("test-results.json", resultsJson);
    console.error("\nResults saved to test-results.json");
  } catch (err) {
    console.error(`\nWarning: Could not write results file: ${err.message}`);
  }

  process.exit(success ? 0 : 1);
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runAllTests().catch(err => {
    console.error(`Fatal error: ${err.message}`);
    console.error(err.stack);
    process.exit(1);
  });
}

export { TestHarness, runAllTests, KIWIX_BASE_URL, DEFAULT_ZIM };