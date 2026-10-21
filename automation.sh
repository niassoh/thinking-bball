#!/bin/bash
export PATH="$HOME/.nvm/versions/node/v24.14.1/bin:$PATH"
cd ~/thinking-bball
node playoffs.js
node sheets-teamcat.js

# Commit changes with today's date
TODAY=$(date +"%Y-%m-%d")
git add .
git commit -m "Daily update for $TODAY: Basketball playoffs data refresh"
git push
exit 0