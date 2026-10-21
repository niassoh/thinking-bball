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
        # Maybe it's already decompressed
        return data

    dictionary = data[0]

    # The dictionary contains both the lookup table and encoded rows
    # Rows starting with "a|" or "o|" are encoded data
    # We need to decode them using the dictionary

    decoded_rows = []

    for item in dictionary:
        if isinstance(item, str) and (item.startswith("a|") or item.startswith("o|")):
            # This is an encoded row
            prefix = item[:2]
            indices_str = item[2:]

            if not indices_str:
                continue

            # Split and decode indices
            indices = indices_str.split("|")
            decoded_row = []

            for idx_str in indices:
                if idx_str == "2b":  # Empty marker
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

    # Find the header row (contains "Player")
    headers = None
    data_rows = []

    for row in decoded_rows:
        if "Player" in row and headers is None:
            headers = row
        elif headers is not None:
            # Skip metadata rows
            if len(row) > 0 and row[0] not in ["range", "Category", ""]:
                data_rows.append(row)

    return headers, data_rows

def process_year_data(compressed_data, year):
    """Convert decompressed data into player-keyed format"""
    headers, data_rows = decompress_custom_format(compressed_data)

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

        player_name = row[player_idx].strip()
        if not player_name:
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
# First, remove old 2025 data from all players
print("\nRemoving old 2025 data...")
removed_count = 0
for player_name in list(final_data.keys()):
    for stat_name in list(final_data[player_name].keys()):
        if isinstance(final_data[player_name][stat_name], dict) and '2025' in final_data[player_name][stat_name]:
            del final_data[player_name][stat_name]['2025']
            removed_count += 1
print(f"Removed {removed_count} old 2025 stat entries")

# Add new 2025 data
print("\nAdding new 2025 data...")
added_2025 = 0
for player_name, stats in processed_2025.items():
    if player_name not in final_data:
        final_data[player_name] = {}

    for stat_name, stat_value in stats.items():
        if stat_name not in final_data[player_name]:
            final_data[player_name][stat_name] = {}
        final_data[player_name][stat_name].update(stat_value)
        added_2025 += 1

print(f"Added {added_2025} new 2025 stat entries")

# Add 2026 data
print("\nAdding 2026 data...")
added_2026 = 0
for player_name, stats in processed_2026.items():
    if player_name not in final_data:
        final_data[player_name] = {}

    for stat_name, stat_value in stats.items():
        if stat_name not in final_data[player_name]:
            final_data[player_name][stat_name] = {}
        final_data[player_name][stat_name].update(stat_value)
        added_2026 += 1

print(f"Added {added_2026} new 2026 stat entries")

# Save the updated data
print("\nSaving updated data...")
with open('final_corrected_player_data.json', 'w', encoding='utf-8') as f:
    json.dump(final_data, f, indent=4, ensure_ascii=False)

print("\nDone! Updated final_corrected_player_data.json with new 2025 and 2026 data")
print(f"Total players in final data: {len(final_data)}")

# Sample a player to verify
if "Carlton Carrington" in final_data and "MP" in final_data["Carlton Carrington"]:
    print(f"\nSample - Carlton Carrington MP: {final_data['Carlton Carrington']['MP']}")
