#!/bin/bash
# Usage: tools/tripo-char.sh <name> <preset...>
# Waits for asset-work/<name>/make.json (multiview task), then rig (v1.0 biped) → retarget presets → web-optimized GLB in public/models.
set -euo pipefail
N=$1; shift
cd "$(dirname "$0")/../asset-work/$N"
until [ -s make.json ]; do sleep 5; done
MODEL=$(node -e "console.log(JSON.parse(require('fs').readFileSync('make.json','utf8')).task_id)")
tripo anim check "$MODEL" --json --yes --no-open > check.json 2> check.log
CHECK=$(node -e "console.log(JSON.parse(require('fs').readFileSync('check.json','utf8')).task_id)")
tripo task get "$CHECK" --json > check-result.json
grep -q '"riggable":true' check-result.json || { echo "$N not riggable"; cat check-result.json; exit 6; }
tripo anim rig "$MODEL" --rig-type biped -p model=rig-v1.0 --out-format glb --name "tiaohai_${N}_rig" -o rig --json --yes --no-open > rig.json 2> rig.log
RIG=$(node -e "console.log(JSON.parse(require('fs').readFileSync('rig.json','utf8')).task_id)")
ANIMS=(); for a in "$@"; do ANIMS+=("preset:biped:$a"); done
tripo anim retarget "$RIG" --animation "${ANIMS[@]}" --animate-in-place --out-format glb --name "tiaohai_${N}_anim" -o anim --json --yes --no-open > anim.json 2> anim.log
SRC=$(node -e "const j=JSON.parse(require('fs').readFileSync('anim.json','utf8'));console.log(j.output_dir+'/'+j.files.find(f=>f.endsWith('.glb')))")
cd ../..
npx gltf-transform optimize "asset-work/$N/$SRC" "public/models/$N.glb" --texture-compress webp --texture-size 1024 --compress meshopt --simplify false
echo "DONE $N"
