import json
import compress_json

# Load the final corrected player data
with open('final_corrected_player_data.json', 'r') as f:
    final_data = json.load(f)

# Load and decompress the 2025 and 2026 data
data_2025 = compress_json.load('2025-data.json')
data_2026 = compress_json.load('2026-data.json')

def process_year_data(data, year):
    """Convert the decompressed data into the player-keyed format"""
    # The data appears to be in a format with headers in the first row
    # and player data in subsequent rows
    values = data.get('values', [])

    if not values:
        print(f"Warning: No values found in {year} data")
        return {}

    # First row contains headers
    headers = values[0]

    # Find the Player column index (should be first non-metadata column)
    player_idx = headers.index('Player') if 'Player' in headers else None

    if player_idx is None:
        print(f"Warning: Could not find Player column in {year} data")
        return {}

    # Process each player row
    player_data = {}
    for row in values[1:]:  # Skip header row
        if len(row) <= player_idx:
            continue

        player_name = row[player_idx]
        if not player_name or player_name.strip() == '':
            continue

        # Create data dict for this player
        player_stats = {}
        for i, header in enumerate(headers):
            if i < len(row) and header != 'Player':
                value = row[i]
                # Skip empty values
                if value != '' and value is not None:
                    player_stats[header] = {str(year): str(value)}

        player_data[player_name] = player_stats

    return player_data

# Process the year data
print("Processing 2025 data...")
processed_2025 = process_year_data(data_2025, 2025)
print(f"Found {len(processed_2025)} players in 2025 data")

print("Processing 2026 data...")
processed_2026 = process_year_data(data_2026, 2026)
print(f"Found {len(processed_2026)} players in 2026 data")

# Update final_data with 2025 (replace) and 2026 (add)
print("\nUpdating player data...")

# Remove old 2025 data from all players
for player_name in final_data:
    for stat_name in final_data[player_name]:
        if '2025' in final_data[player_name][stat_name]:
            del final_data[player_name][stat_name]['2025']

# Add new 2025 data
for player_name, stats in processed_2025.items():
    if player_name not in final_data:
        final_data[player_name] = {}

    for stat_name, stat_value in stats.items():
        if stat_name not in final_data[player_name]:
            final_data[player_name][stat_name] = {}
        final_data[player_name][stat_name].update(stat_value)

# Add 2026 data
for player_name, stats in processed_2026.items():
    if player_name not in final_data:
        final_data[player_name] = {}

    for stat_name, stat_value in stats.items():
        if stat_name not in final_data[player_name]:
            final_data[player_name][stat_name] = {}
        final_data[player_name][stat_name].update(stat_value)

# Save the updated data
print("\nSaving updated data...")
with open('final_corrected_player_data.json', 'w') as f:
    json.dump(final_data, f, indent=4)

print("Done! Updated final_corrected_player_data.json with 2025 and 2026 data")
