import compress_json

# Load the data
data_2025 = compress_json.load('2025-data.json')

print("Item 1 type:", type(data_2025[1]))
print("Item 1 length:", len(data_2025[1]))
print("First 200 chars:", data_2025[1][:200])
print("\nLast 200 chars:", data_2025[1][-200:])

# Check if it looks like encoded/compressed data
print("\nSample from middle:", data_2025[1][1000:1200])
