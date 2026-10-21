import compress_json

# Load and decompress the 2025 data to see its structure
data_2025 = compress_json.load('2025-data.json')

print("Type of data:", type(data_2025))
print("Length:", len(data_2025))

if isinstance(data_2025, list):
    print("\nChecking list structure...")
    print(f"Number of top-level items: {len(data_2025)}")

    for i, item in enumerate(data_2025):
        print(f"\nItem {i}:")
        print(f"  Type: {type(item)}")
        if isinstance(item, list):
            print(f"  Length: {len(item)}")
            if len(item) > 0:
                print(f"  First 5 elements: {item[:5]}")
        elif isinstance(item, dict):
            print(f"  Keys: {list(item.keys())[:5]}")

# Also save to a file to inspect
with open('decompressed_2025_structure.txt', 'w', encoding='utf-8') as f:
    f.write(f"Top level length: {len(data_2025)}\n\n")
    for i, item in enumerate(data_2025):
        f.write(f"Item {i} - Type: {type(item)}, Length: {len(item) if isinstance(item, (list, dict)) else 'N/A'}\n")
        if isinstance(item, list) and len(item) > 0:
            f.write(f"  First 10 elements: {item[:10]}\n")

print("\nStructure saved to decompressed_2025_structure.txt")
