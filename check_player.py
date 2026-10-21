import json

def base62_decode(s):
    """Decode a base-62 string to an integer index"""
    chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
    result = 0
    for char in s:
        result = result * 62 + chars.index(char)
    return result

def decompress_custom_format(data):
    """Decompress the custom dictionary-based format"""
    if not isinstance(data, list) or len(data) != 2:
        return data

    dictionary = data[0]
    decoded_rows = []

    for item in dictionary:
        if isinstance(item, str) and (item.startswith("a|") or item.startswith("o|")):
            prefix = item[:2]
            indices_str = item[2:]

            if not indices_str:
                continue

            indices = indices_str.split("|")
            decoded_row = []

            for idx_str in indices:
                if idx_str == "2b":
                    decoded_row.append("")
                else:
                    try:
                        idx = base62_decode(idx_str)
                        if idx < len(dictionary):
                            decoded_row.append(dictionary[idx])
                        else:
                            decoded_row.append("")
                    except (ValueError, IndexError):
                        decoded_row.append("")

            decoded_rows.append(decoded_row)

    headers = None
    data_rows = []

    for row in decoded_rows:
        if "Player" in row and headers is None:
            headers = row
        elif headers is not None:
            if len(row) > 0 and row[0] not in ["range", "Category", ""]:
                data_rows.append(row)

    return headers, data_rows

# Load and decompress 2025 data
with open('2025-data.json', 'r', encoding='utf-8') as f:
    compressed_2025 = json.load(f)

headers, data_rows = decompress_custom_format(compressed_2025)
player_idx = headers.index("Player")

# Find all players with "Carlton" or "Carrington" in their name
print("Searching for Carlton Carrington...")
for row in data_rows:
    if player_idx < len(row):
        player_name = row[player_idx]
        if "Carlton" in player_name or "Carrington" in player_name:
            print(f"\nFound: {player_name}")
            mp_idx = headers.index("MP")
            gp_idx = headers.index("GP")
            print(f"  MP: {row[mp_idx] if mp_idx < len(row) else 'N/A'}")
            print(f"  GP: {row[gp_idx] if gp_idx < len(row) else 'N/A'}")

print(f"\n\nTotal players in 2025 data: {len(data_rows)}")
print(f"First 10 players:")
for i, row in enumerate(data_rows[:10]):
    if player_idx < len(row):
        print(f"  {i+1}. {row[player_idx]}")
