import urllib.request
import json

base_url = "http://127.0.0.1:8000"

def test_api():
    # 1. Health check
    with urllib.request.urlopen(f"{base_url}/") as response:
        health = json.loads(response.read().decode())
        print("1. Health Check:", health)

    # 2. Knowledge Base (RAG)
    with urllib.request.urlopen(f"{base_url}/api/knowledge") as response:
        docs = json.loads(response.read().decode())
        print(f"2. ChromaDB Indexed Docs: {len(docs)} documents found.")
        for d in docs[:2]:
            print(f"   - {d.get('metadata', {}).get('title')}: {d.get('metadata', {}).get('category')}")

    # 3. Calendar Check
    with urllib.request.urlopen(f"{base_url}/api/calendar/availability?date=2026-10-08") as response:
        avail = json.loads(response.read().decode())
        print(f"3. Calendar Availability for {avail.get('date')}:", avail.get('available_slots'))

    # 4. Conversations List
    with urllib.request.urlopen(f"{base_url}/api/conversations") as response:
        convs = json.loads(response.read().decode())
        print(f"4. Total Active Conversations: {len(convs)}")

    print("\n✅ All Backend Core Services and APIs are responding correctly!")

if __name__ == "__main__":
    test_api()
