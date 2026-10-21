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
    # Data rows start with "a|" and contain pipe-separated indices
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

def process_year_data(compressed_data, year):
    """Convert decompressed data into player-keyed format"""
    headers, data_rows = decompress_data(compressed_data)

    if not headers:
        print(f"Warning: No headers found in {year} data")
        return {}

    # Find Player column index
    try:
        player_idx = headers.index("Player")
    except ValueError:
        print(f"Warning: No Player column found in {year} data")
        return {}

    # Build player data
    player_data = {}
    for row in data_rows:
        if len(row) <= player_idx or not row[player_idx]:
            continue

        player_name = row[player_idx]
        if not player_name.strip():
            continue

        # Initialize player if not exists
        if player_name not in player_data:
            player_data[player_name] = {}

        # Add each stat for this player
        for i, header in enumerate(headers):
            if i >= len(row) or header == "Player":
                continue

            value = row[i]
            if value != "" and value is not None:
                if header not in player_data[player_name]:
                    player_data[player_name][header] = {}
                player_data[player_name][header][str(year)] = str(value)

    return player_data

# Load the files
print("Loading files...")
with open('final_corrected_player_data.json', 'r', encoding='utf-8') as f:
    final_data = json.load(f)

with open('2025-data.json', 'r', encoding='utf-8') as f:
    compressed_2025 = json.load(f)

with open('2026-data.json', 'r', encoding='utf-8') as f:
    compressed_2026 = json.load(f)

# Process the year data
print("\nProcessing 2025 data...")
processed_2025 = process_year_data(compressed_2025, 2025)
print(f"Found {len(processed_2025)} players in 2025 data")

print("\nProcessing 2026 data...")
processed_2026 = process_year_data(compressed_2026, 2026)
print(f"Found {len(processed_2026)} players in 2026 data")

# Update final_data
print("\nRemoving old 2025 data...")
removed_count = 0
for player_name in list(final_data.keys()):
    for stat_name in list(final_data[player_name].keys()):
        if '2025' in final_data[player_name][stat_name]:
            del final_data[player_name][stat_name]['2025']
            removed_count += 1
print(f"Removed {removed_count} old 2025 stat entries")

# Add new 2025 data
print("\nAdding new 2025 data...")
for player_name, stats in processed_2025.items():
    if player_name not in final_data:
        final_data[player_name] = {}

    for stat_name, stat_value in stats.items():
        if stat_name not in final_data[player_name]:
            final_data[player_name][stat_name] = {}
        final_data[player_name][stat_name].update(stat_value)

# Add 2026 data
print("Adding 2026 data...")
for player_name, stats in processed_2026.items():
    if player_name not in final_data:
        final_data[player_name] = {}

    for stat_name, stat_value in stats.items():
        if stat_name not in final_data[player_name]:
            final_data[player_name][stat_name] = {}
        final_data[player_name][stat_name].update(stat_value)

# Save the updated data
print("\nSaving updated data...")
with open('final_corrected_player_data.json', 'w', encoding='utf-8') as f:
    json.dump(final_data, f, indent=4, ensure_ascii=False)

print("\nDone! Updated final_corrected_player_data.json with new 2025 and 2026 data")
print(f"Total players in final data: {len(final_data)}")
