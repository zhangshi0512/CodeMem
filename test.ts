import dotenv from 'dotenv';
import { EverMemClient } from './src/evermind-client.js';

dotenv.config();

const EVERMEM_API_KEY = process.env.EVERMEM_API_KEY;

if (!EVERMEM_API_KEY) {
  console.error("EVERMEM_API_KEY environment variable is not set.");
  process.exit(1);
}

const client = new EverMemClient(EVERMEM_API_KEY);
const testUserId = 'test_user_001';
const testGroupId = 'test_group_001';

async function runTest() {
  console.log("🚀 Starting EverMemOS Client Test...\n");

  try {
    // 1. Test Adding Memory
    console.log("1️⃣ Testing: Add Memory...");
    const addResult = await client.addMemory({
      message_id: `test_msg_${Date.now()}`,
      create_time: new Date().toISOString(),
      sender: testUserId,
      group_id: testGroupId,
      role: 'assistant',
      content: "This is a test decision: We have decided to use the EverMemOS API for our memory backend instead of local SQLite. This is a critical architectural decision.",
      flush: true
    });
    console.log("✅ Add Memory Success:", addResult);
    
    // Give it a brief moment for processing/indexing
    console.log("\nWaiting 3 seconds for memory to be indexed...");
    await new Promise(resolve => setTimeout(resolve, 3000));

    // 2. Test Searching Memory
    console.log("\n2️⃣ Testing: Search Memory...");
    const searchResult = await client.searchMemories({
      user_id: testUserId,
      group_ids: [testGroupId],
      query: "What is our memory backend?",
      memory_types: ['episodic_memory'],
      retrieve_method: 'hybrid',
      top_k: 2
    });
    
    console.log("✅ Search Memory Success!");
    console.log(`Found ${searchResult.result.total_count} results.`);
    
    if (searchResult.result.memories && searchResult.result.memories.length > 0) {
        console.log("\nTop Result:");
        const topMem = searchResult.result.memories[0];
        console.log(`Type: ${topMem.memory_type}`);
        if (topMem.memory_type === 'episodic_memory') {
            console.log(`Summary: ${topMem.summary}`);
        } else if (topMem.memory_type === 'event_log') {
            console.log(`Fact: ${topMem.atomic_fact}`);
        }
        console.log(`Raw Content/Original: ${JSON.stringify(topMem.original_data || "N/A")}`);
    } else {
        console.log("⚠️ No memories were returned by the search.");
    }

    console.log("\n🎉 All tests completed successfully!");

  } catch (error: any) {
    console.error("\n❌ Test Failed:", error.message);
  }
}

runTest();
