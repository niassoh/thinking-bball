import json

def base62_decode(s):
    """Decode a base-62 string to an integer index"""
    chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
    result = 0
    for char in s:
        result = result * 62 + chars.index(char)
    return result

def decompress_data(compressed):
    """Decompress the custom compressed format"""
    if not isinstance(compressed, list) or len(compressed) != 2:
        raise ValueError("Invalid compressed format")

    dictionary = compressed[0]

    # Find the data rows in the dictionary
    data_rows = []
    headers = None

    for item in dictionary:
        if isinstance(item, str) and item.startswith("a|"):
            # This is an encoded data row
            indices_str = item[2:]  # Remove "a|" prefix
            if not indices_str:
                continue

            # Decode each index
            indices = indices_str.split("|")
            decoded_row = []
            for idx_str in indices:
                if idx_str == "2b":  # Special marker for empty/null
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

            # Check if this is the header row (contains "Player", "Tm", etc.)
            if "Player" in decoded_row:
                headers = decoded_row
            else:
                data_rows.append(decoded_row)

    return headers, data_rows

# Load the 2025 data
with open('2025-data.json', 'r', encoding='utf-8') as f:
    compressed_2025 = json.load(f)

print("Processing 2025 data...")
headers, data_rows = decompress_data(compressed_2025)

print(f"Total rows: {len(data_rows)}\n")

# Check the first several rows
for i in range(min(10, len(data_rows))):
    player_idx = headers.index("Player")
    player_name = data_rows[i][player_idx] if player_idx < len(data_rows[i]) else "N/A"
    print(f"Row {i}: Player = '{player_name}'")
