
/* =========================================================================
   ORE — Bedrock VFX Node Editor
   A node editor modeled on Unity VFX Graph that generates Bedrock particle JSON (Molang).
   ========================================================================= */

/* =========================================================================
   [Code map] A rough guide to the structure, for people and AI reading this file
   -------------------------------------------------------------------------
   [Auto-generated file] mcp_tool/core/ore-core.js — do not edit by hand.
     The calculation part of html/ore_vfx_editor.html (the web editor), extracted so it runs without a screen:
     formula parser, node definitions, graph → Molang → JSON compiler, simulator (OreSim core), Molang optimizer
     (OreOpt core) and the English text table (ORE_I18N_EN / oreT). After changing the HTML, run `npm run sync`
     in mcp_tool (tools/sync-core.mjs). Added during extraction: window. → globalThis., the OreOpt.maxEstMs
     setting and the headless API (OreCore) at the end. Section numbers refer to the HTML; UI sections are not here.
   Detailed comments inside the code are mostly in Korean.

   ■ Language
     0     ORE_I18N_EN / oreT()  — the UI text is written in Korean in the code; oreT() turns finished text into
           English. "0-UI. Language" translates the page as it changes; the EN/한국어 switch is the last block.
           To translate a new message, add "Korean": "English" to ORE_I18N_EN (keep {0}, {1} placeholders).

   ■ Data
     state            The graph you are looking at: nodes{id→{id,type,x,y,data}}, wires{id→{from:{node,socket},to:{node,socket}}},
                      nextId, camera (scale/panX/panY), pack (.mcpack settings). Node keys starting with '_' are runtime objects (not saved).
     NODE_DEFS        Definition per node type: label, color, inputs/outputs (sockets), defaults (initial data of a new node).
     DETAIL_INPUTS    Number fields that become sockets when "Advanced settings" is open (per node type). nodeAllInputs() merges sockets + those fields.
                      Wall nodes get more fields with more walls, so detailKeysOf(node) builds "w<number>:<field>" keys.

   ■ Flow: node graph → Molang → Bedrock JSON
     1–2  Formula parser, Shape presets
     3    State · createNode/createWire
     4    renderNode: draws a node in the DOM (body HTML per type) + field events → updates node.data
     5–7  Node dragging · socket connections · canvas pan/zoom
     8    Code generator
          buildGraph(context,…)   Walks backwards from the Output sockets and builds Molang lines for each node.
                                   context: 'off' (once at spawn) · 'frame' (every frame) · motion* (for integrating position).
                                   Per-type compilation is the big if(node.type===…) section inside buildGraph.
          Accumulate (acc*)       Stateless integration: every frame, integrate again from age 0 in N steps. N is chosen to keep
                                   formulas under the length limit (55KB).
          generateParticleJSON    One emitter + one Output → one particle_effect JSON (builds components, merges events).
     8.5  generateAllParticleJSONs(baseId)  Whole canvas → list of results. Assigns emitter identifiers, collects Event/Particle Event,
          splits files above 1000 particles, checks Constant-node variables. Export, the 3D preview and .mcpack all use its results.
     9–11 Palette, save/load/export dialog, the sample graph shown at startup
     ORE Sim   globalThis.OreSim  — runs the generated JSON directly: 3D preview / checker, .mcpack zip (buildPack)
     ORE Opt   globalThis.OreOpt  — Molang optimizer before export (applied only after a numeric check shows the same values)
     Layout    — PC: 3D preview on top / node graph below / library on the left; mobile: switch between Nodes and 3D
     OreEdit   — multi-select, copy/paste, undo (snapshots), mobile select mode
     OreTabs   — multiple graph tabs. Only the tab you are viewing is in state; the others are kept in OreTabs.list
     OrePackDialog — .mcpack name/description/icon/include-all-tabs dialog

   ■ Adding a new node type
     Define it in NODE_DEFS → palette (.pal-item data-add) → body UI in renderNode → compilation in buildGraph
     (+ if needed DETAIL_INPUTS, a preview in renderNodePreview, the wire color in colorMap, and English text in ORE_I18N_EN)

   ■ A promise we keep
     Adding a feature must not change a single character of the export for graphs that don't use that feature
     (new options output nothing while they are off or empty). Switching the language never changes the export either.

   ■ MCP
     mcp_tool/ (in the GitHub repository) runs the calculation part of this file without a screen, so AI apps can edit graphs.
     After changing this file, run `npm run sync` in mcp_tool to update its copy.
   ========================================================================= */

/* -------------------------------------------------------------------------
   0. Language (i18n) — English / Korean
   The source text of the editor is Korean. oreT() turns a finished Korean
   string into English when the language is 'en' (the default):
     - exact phrases:  ORE_I18N_EN["초기화"] = "Clear"
     - phrases with values: keys contain {0}, {1}… ("파티클 {0}개" → "{0} particles");
       each captured value is translated again, so nested messages work too.
   Nothing here changes what the compiler outputs — only text shown to people.
   New Korean text without an entry simply stays Korean. To translate it, add
   "Korean": "English" to ORE_I18N_EN (keep the same {n} placeholders).
   The browser part (watching the page and the EN/한국어 switch) is in the UI
   section "0-UI. Language"; the MCP server calls OreCore.translate().
   ------------------------------------------------------------------------- */
const ORE_I18N_EN = {
  "\"namespace:name\" 형식, 소문자·숫자·_·. 만 쓸 수 있습니다": "Must be \"namespace:name\"; only lowercase letters, digits, _ and . are allowed",
  "\"{0}\" 탭을 닫을까요? 저장하지 않은 노드는 사라집니다.": "Close the \"{0}\" tab? Nodes that haven't been saved will be lost.",
  "(Emitter 제외)": "(Emitter excluded)",
  "(Kuhl & Giardina 1982 — pyefd/ElliShape 등 형태 분석 소프트웨어의 표준 기법)로 x(t)/y(t)를 각각 독립적인 cos/sin 급수로 피팅합니다. 덩어리가 여러 개면 조건문(삼항) 없이 \"경계 통과 여부\"를 clamp로 계산하는 마스크 가중합 수식으로 결합해, 각 파티클이 자기 덩어리만 정확히 따라가게 합니다. Bedrock Molang은 텍스처를 직접 샘플링할 수 없어, 결과 계수를 그대로 삼각함수 다항식(exprX/exprZ)으로 구워 넣습니다.": "(Kuhl & Giardina 1982 — the standard method in shape-analysis tools such as pyefd and ElliShape) fits x(t) and y(t) each as an independent cos/sin series. With several shapes, they are combined into one masked weighted sum that uses clamp (no if/ternary) to decide which shape a particle belongs to, so each particle follows only its own shape. Bedrock Molang cannot sample textures, so the resulting coefficients are baked directly into trigonometric formulas (exprX/exprZ).",
  "(미리보기 값": "(preview value",
  "(원본유지": "(kept original",
  "(원본유지 {0}": "(kept original {0}",
  "(원본유지 {0})": "(kept original {0})",
  "(전체 합본)": "(combined)",
  "(점유중)": "(linked)",
  "(현재 소켓 연결됨 — 이 필드는 무시됨)": "(a socket is connected — this field is ignored)",
  ") 원본을 유지했습니다.": "), so the original was kept.",
  "+ 정지점 추가": "+ Add stop",
  ", 검증 예상": ", check would take",
  ", 검증 예상 {0}": ", check would take {0}",
  ", 검증 예상 {0}초": ", check would take {0}s",
  ".json으로 저장": "Save as .json",
  ".mcpack 추출 시 이 이미지가 파티클 텍스처(textures/particle/)로 들어갑니다": "When exporting a .mcpack, this image is included as the particle texture (textures/particle/)",
  ".txt 파일에서 진행사항 불러오기": "Load saved progress from a .txt file",
  ".txt로 저장": "Save as .txt",
  "1 또는 v.my_power": "1  or  v.my_power",
  "1회(clamp 후 정지 · 보통 이걸 사용)": "Once (clamp, then stop · usually what you want)",
  "1회성 (끝까지 가면 마지막 값 유지)": "Once (hold the last value at the end)",
  "2D 단면 미리보기": "2D slice preview",
  "2D 저주파 sin/cos 합으로 벡터장 전체를 근사 — 조건문이 전혀 없어 Bedrock에서 항상 안전합니다. 현재 {0}개 항 → Molang 호출 약 {1}개(fx·fy 각각 sin+cos {2}쌍) 고정, 베이킹 해상도(그리드 세밀함)와 무관합니다. 항이 적으면 뭉뚱그려진 부드러운 흐름, 많으면 원본에 더 가까워지되 길어집니다. 각지고 뾰족한 형태(글자·직선 로고)는 sin/cos 특성상 완전히 재현되진 않고 둥글게 뭉개져 보일 수 있습니다.": "Approximates the whole field with a sum of 2D low-frequency sin/cos terms — there are no conditionals at all, so it is always safe in Bedrock. Currently {0} terms → about {1} Molang calls (sin+cos {2} pairs each for fx and fy), fixed and independent of the bake resolution. Few terms give a soft, blurred flow; more terms get closer to the original but longer. Sharp, angular shapes (text, straight-edged logos) can't be reproduced exactly with sin/cos and may look rounded.",
  "3D 프리뷰에 이 노드의 벽 표시/숨김": "Show/hide this node's walls in the 3D preview",
  ": 밝은 곳→어두운 곳 방향(등고선처럼 흐름, 사진/텍스처에 적합).": ": flows from bright to dark (like contour lines; good for photos and textures).",
  ": 밝은 영역을 마스크로 보고 그 윤곽을 따라 회전하는 흐름(로고·실루엣에 적합, 소용돌이형).": ": treats bright areas as a mask and flows around their outline (good for logos and silhouettes; swirl-like).",
  ": 빨강 채널을 X방향, 초록 채널을 Y방향(각 128=0, 0/255=-1/+1)으로 직접 사용 — 게임 업계에서 물 흐름·바람 효과에 실제로 쓰는 \"Flow Map\" 텍스처 규격과 동일. x/y 입력에 Shape 좌표를 연결하면 그 위치에 해당하는 힘이 나온다.": ": uses the red channel as X and the green channel as Y directly (128 = 0, 0/255 = −1/+1) — the same \"Flow Map\" texture convention games use for water and wind. Connect Shape coordinates to the x/y inputs to get the force at that position.",
  "ALL 빌드 실패:": "ALL build failed:",
  "ALL 빌드 실패: {0}": "ALL build failed: {0}",
  "ALL 재생: 이미터 {0}개 · 파티클 최대 {1}개 · {2}초 (메인 이미터 기준)": "ALL playback: {0} emitters · up to {1} particles · {2} s (from the main emitter)",
  "Accumulate (누적)": "Accumulate",
  "Accumulate 노드({0})가 적분 중인 {1}와 init 등 비반복 경로로 서로 얽혀 있어 계산할 수 없습니다. 한쪽의 init 연결을 끊어 주세요.": "Accumulate node ({0}) is tangled with {1}, which is being integrated, through a non-loop path such as init, so it can't be computed. Disconnect the init on one of them.",
  "Accumulate 노드({0})의 init이 같은 피드백 그룹({1})의 출력에 의존합니다. init은 시작값이라 그룹 결과를 쓸 수 없으니 init 연결을 끊거나 다른 노드에서 받아 주세요.": "The init of Accumulate node ({0}) depends on the output of its own feedback group ({1}). init is the start value and can't use the group's result — disconnect init or take it from another node.",
  "Add (가산·발광 효과)": "Add (additive · glowing effects)",
  "Alpha (불투명/완전투명만)": "Alpha (fully opaque or fully transparent only)",
  "Attractor / Point Force(물리 모델): F = s·w(r)·g(r)·(중심−x) − c·w(r)·v. w=(1−r²/R²)²는 반경 경계에서 힘이 0으로 연속 수렴하는 윈도우, g는 소프트닝 ε를 둔 거리 의존항(Linear=스프링형 1/√(r²+ε²), Inverse=Plummer 중력 ε²/(r²+ε²)^1.5)이다. 힘이 중심·경계 어디서도 불연속이 아니라서 오버슈트/에너지 주입이 없고, 위치-속도 Accumulate 쌍은 심플렉틱 오일러로 적분되어 발산하지 않는다. 감쇠 없이는 보존계라 중심 주위를 영원히 도므로(이게 정상 물리), 중심에 모으려면 속도 Accumulate 출력을 vel.x/y/z에 연결하고 drag c>0을 준다(임계감쇠 c≈2√(s/ε), 즉 진동 없이 정착).": "Attractor / Point Force (physics model): F = s·w(r)·g(r)·(center − x) − c·w(r)·v. w = (1 − r²/R²)² is a window that fades the force smoothly to 0 at the radius; g is a distance term with softening ε (Linear = spring-like 1/√(r²+ε²), Inverse = Plummer gravity ε²/(r²+ε²)^1.5). The force has no jumps at the center or the edge, so there is no overshoot or added energy, and the position–velocity Accumulate pair is integrated with symplectic Euler so it never blows up. Without damping the system conserves energy and orbits the center forever (that is correct physics); to gather particles at the center, connect the velocity Accumulate output to vel.x/y/z and set drag c > 0 (critical damping c ≈ 2√(s/ε) settles without wobbling).",
  "B 채널": "B channel",
  "Blend (일반 반투명 블렌드)": "Blend (normal semi-transparent blending)",
  "Box (축별 반너비)": "Box (half-size per axis)",
  "Buoyancy: 온도차(T-T_ambient)에 비례해 방향(dirX,dirY,dirZ · 기본 위쪽)으로 미는 힘 — 실제 Pyro/Gas 시뮬레이션에서 뜨거운 연기·불이 위로 뜨는 원리(Houdini pop buoyancy와 동일 개념). temperature 소켓을 연결하지 않으면 \"이미터가 켜진 직후일수록 뜨겁다\"고 가정해 emitter_age에 따라 부력이 약해진다 — 발화 직후 강하게 솟구치다가 점점 힘을 잃고 퍼지는 연출에 적합.": "Buoyancy: a push along (dirX, dirY, dirZ) (up by default) proportional to the temperature difference (T − T_ambient) — the same reason hot smoke and fire rise in Pyro/Gas simulations (same idea as Houdini POP Buoyancy). If the temperature socket is not connected, it assumes \"hottest right after the emitter starts\", so buoyancy weakens with emitter_age — good for a burst that shoots up right after ignition, then slowly loses force and spreads.",
  "Constant (상수)": "Constant",
  "Curl Noise(터뷸런스): Perlin 노이즈장의 회전(curl)을 취해 만든 발산-없는 벡터장. 일반 노이즈로 위치를 직접 흔들면 파티클이 한 점에 뭉치기 쉽지만, curl은 소용돌이 형태로만 흐르므로 뭉침 없이 자연스럽게 휘돈다. scale은 입력 좌표(x,y,z)를 그대로 스케일링해 벡터장의 \"물리적 크기\"를 조절한다 — 값을 낮추면(예: 0.1) 크고 완만한 소용돌이 하나, 값을 높이면(예: 2) 자잘하고 촘촘한 소용돌이가 많아진다. scale/amplitude 소켓에 Formula(t)를 연결하면 시간에 따라 소용돌이 크기·세기가 변하는 연출도 가능하다. 출력 force.x/y/z를 Formula로 기존 위치(Shape의 x/y/z)에 더해 연기·불·물의 유체형 움직임을 낸다.": "Curl Noise (turbulence): a divergence-free vector field made from the curl of a Perlin noise field. Shaking positions with plain noise tends to bunch particles into clumps, but curl only flows in swirls, so particles twist naturally without clumping. scale scales the input position (x, y, z) and sets the \"physical size\" of the field — lower it (e.g. 0.1) for one big, gentle swirl, raise it (e.g. 2) for many small, tight swirls. Connect a Formula(t) to the scale/amplitude sockets to make the swirl size or strength change over time. Add the force.x/y/z outputs to an existing position (a Shape's x/y/z) with a Formula for fluid-like smoke, fire or water motion.",
  "Curl Noise를 여러 옥타브로 겹친 다중 스케일 난류 — fx/fy/fz 힘 출력. Houdini POP Turbulence, Unity VFX Graph \"Turbulence\"와 동일 개념. 큰 소용돌이 위에 작은 디테일이 겹쳐 연기·구름처럼 복잡한 흐름을 만듦. flow 옵션으로 시간에 따라 흐르게 가능": "Curl Noise stacked over several octaves for multi-scale turbulence — outputs a force fx/fy/fz. Same idea as Houdini POP Turbulence and Unity VFX Graph \"Turbulence\". Small details ride on top of big swirls, giving complex smoke- or cloud-like motion. The flow option makes it drift over time",
  "DNA 형태 이중 나선(반지름 보간 가능)": "DNA-style double helix (radius can be blended)",
  "Directional Force: 위치와 무관하게 항상 (dirX,dirY,dirZ) 방향으로 일정하게 미는 힘(Unreal Niagara \"Gravity Force\"/\"Wind Force\"의 단순화 버전). 방향 벡터는 내부에서 자동 정규화된다. 기본값(0,-1,0)은 중력처럼 아래로 당기는 힘. strength 입력 소켓에 Formula(t)를 연결하면 더 자유로운 시간 변조도 가능하다.": "Directional Force: a constant push in the (dirX, dirY, dirZ) direction, the same everywhere (a simplified Unreal Niagara \"Gravity Force\" / \"Wind Force\"). The direction is normalized automatically. The default (0, −1, 0) pulls down like gravity. Connect a Formula(t) to the strength input for any time-based variation you like.",
  "Dissipation: out = max(floor, start·2^(-t/halfLife)) 형태의 지수 감쇠(half-life 기준). 문서의 D_(t+1)=D_t·(1-α·Δt)와 동일한 현상(밀도/온도/연료가 시간에 따라 서서히 사라짐)을 반감기 개념으로 직관적으로 조절한다. tint.a에 연결하면 연기가 옅어지며 사라지고, size에 연결하면 불씨가 시간이 지나며 작아진다. rate 소켓을 연결하면 half-life 대신 그 값을 직접 감쇠율로 쓴다(rate = ln(2)/halfLife 관계).": "Dissipation: an exponential fade of the form out = max(floor, start·2^(−t/halfLife)). It models the same thing as D_(t+1) = D_t·(1 − α·Δt) (density, heat or fuel slowly disappearing) but lets you tune it intuitively with a half-life. Connect it to tint.a for smoke that thins out and vanishes, or to size for embers that shrink over time. If the rate socket is connected, that value is used directly as the decay rate instead of half-life (rate = ln(2)/halfLife).",
  "Drag / Damping (v5): Bedrock의 motion.linear_drag_coefficient(acceleration += -coeff × velocity)를 본뜬 항력 계수 하나를 출력합니다. 참고: 이 에디터는 파티클을 엔진 물리가 아니라 수식(particle_motion_parametric)으로 움직이므로 Output 노드에 drag 소켓이 없고, 엔진의 항력도 적용되지 않습니다. 출력은 Formula 같은 다른 노드에 숫자로 연결해 쓸 수 있습니다.": "Drag / Damping (v5): outputs one number, a drag coefficient modeled on Bedrock's motion.linear_drag_coefficient (acceleration += −coeff × velocity). Note: the Output node has no drag socket — this editor moves particles by formula (particle_motion_parametric), not by the engine's physics — so the engine's drag is never applied. You can still use the output as a plain number in other nodes (for example a Formula).",
  "EFD 하모닉 차수(높을수록 디테일↑, 수식↑)": "EFD harmonics (higher = more detail, longer formula)",
  "Emitter 노드가 없습니다. 팔레트에서 추가하세요.": "There is no Emitter node. Add one from the palette.",
  "Emitter는 하나만 둘 수 있어 붙여넣지 않았습니다": "Not pasted: there can be only one Emitter",
  "Emitter와 동일 + bone 입력. Event에 연결되어 발동되는 별도 파티클": "Same as Emitter plus a bone input. A separate particle effect that is fired by an Event",
  "Event 노드가 이미터 전체에 한 번 발동한다면, 이 노드는 파티클 하나하나마다 발동합니다(minecraft:particle_lifetime_events). 문서에 따르면 생성되는 Sub Emitter는 이벤트가 일어난 월드 위치(= 그 파티클 위치)에 생깁니다. 파티클이 500개면 500번 발동하므로 Sub Emitter 개수가 크게 늘 수 있습니다. 소리 이름은 마인크래프트 level sound event 이름을 씁니다. 3D 미리보기는 이벤트를 재생하지 않습니다.": "An Event node fires once for the whole emitter; this node fires for every single particle (minecraft:particle_lifetime_events). According to the documentation, the Sub Emitter it creates appears at the world position where the event happened (= that particle's position). 500 particles means 500 firings, so the number of Sub Emitters can grow a lot. Sound names are Minecraft level sound event names. The 3D preview does not play these events.",
  "Event({0})는 \"발동원의 bone에 부착\"이 켜져 있지만, Sub Emitter({1})의 bone 입력이 연결되어 있지 않습니다. 상류 Emitter/Sub Emitter의 bone 출력을 이 Sub Emitter의 bone 입력에 연결하거나, 체크박스를 해제하세요.": "Event ({0}) has \"Attach to the source's bone\" turned on, but the bone input of Sub Emitter ({1}) is not connected. Connect the bone output of the upstream Emitter/Sub Emitter to this Sub Emitter's bone input, or uncheck the box.",
  "Export 방식": "Export method",
  "F 맞춤 · Space 프리뷰 · 그래프 우클릭=노드 추가 · 프리뷰 우클릭+WASD · Ctrl+E 추출": "F fit · Space preview · right-click graph = add node · right-click + WASD in preview · Ctrl+E export",
  "FBM (Perlin 옥타브 중첩 · 구름/연기/불)": "FBM (stacked Perlin octaves · clouds, smoke, fire)",
  "FBM(Fractal Brownian Motion): Perlin 노이즈를 octaves만큼 겹쳐서 큰 덩어리 위에 잔디테일을 더한다. 각 겹은 주파수가 lacunarity배씩 커지고 진폭이 gain배씩 줄어든다 — Houdini/Unity에서 구름·연기·불꽃 질감을 만들 때 표준으로 쓰는 방식.": "FBM (Fractal Brownian Motion) stacks octaves layers of Perlin noise so fine detail sits on top of big shapes. Each layer has lacunarity× the frequency and gain× the amplitude of the previous one — the standard way to make cloud, smoke and flame textures in Houdini and Unity.",
  "Force Field · 벡터장 (Unity/Unreal 표준)": "Force Field · vector fields (Unity/Unreal style)",
  "Formula 노드({0}) 수식 오류: {1}": "Formula node ({0}) formula error: {1}",
  "G 채널": "G channel",
  "Inverse-Square (Plummer 소프트닝 중력)": "Inverse-Square (Plummer-softened gravity)",
  "Linear (스프링형: 중심 근처 조화진동, 멀리선 일정)": "Linear (spring-like: oscillates near the center, constant far away)",
  "Math · 커스텀 수식": "Math · custom formulas",
  "Molang 실행 (expression · 비우면 없음)": "Run Molang (expression · empty = none)",
  "Molang 오류 ({0}): {1}": "Molang error ({0}): {1}",
  "Noise · 실시간 미리보기 포함": "Noise · with live preview",
  "Over-Life 커브: 가로축=t(0~1), 세로축=출력값(Unity Particle System의 Size/Color over Lifetime과 동일 개념). t 입력 소켓을 다른 노드에 연결하면 위 자동 설정 대신 그 값을 사용.": "Over-life curve: horizontal axis = t (0–1), vertical axis = output (same idea as Size/Color over Lifetime in Unity's Particle System). If the t input is connected to another node, that value is used instead of the automatic settings above.",
  "Perlin (그라디언트 노이즈 · 부드러움)": "Perlin (gradient noise · smooth)",
  "Perlin/Simplex/Voronoi/FBM 선택 가능. x/y/z→노이즈값 n. 연결 위치 자동 역추적(offset=1회, tint/size=파티클마다 재계산). 노드 안에서 패턴을 흑백 이미지로 바로 확인": "Choose Perlin, Simplex, Voronoi or FBM. Takes x/y/z and outputs a noise value n. It works out where it is connected automatically (on offset it is computed once; on tint/size it is recomputed for every particle). The node shows the pattern as a black-and-white image",
  "R 채널": "R channel",
  "RGB 플로우맵": "RGB flow map",
  "RGB 플로우맵(R=X,G=Y)": "RGB flow map (R = X, G = Y)",
  "Remap: in을 [inMin,inMax] 구간에서 [outMin,outMax] 구간으로 선형 재매핑(Unity Shader/VFX Graph의 \"Remap\", Houdini의 \"Fit\" 노드와 동일). 예: Noise 3D의 출력(-1~1)을 0~1로 바꿔 알파값에 바로 쓰거나, Vortex/Attractor 힘의 세기 범위를 다른 스케일로 옮길 때 사용한다.": "Remap: linearly maps in from [inMin, inMax] to [outMin, outMax] (same as \"Remap\" in Unity Shader/VFX Graph and \"Fit\" in Houdini). For example, turn Noise 3D's −1…1 output into 0…1 to use it directly as alpha, or move the strength of a Vortex/Attractor force to a different scale.",
  "Shape (Image Contour) 노드({0}) 수식 오류: {1}": "Shape (Image Contour) node ({0}) formula error: {1}",
  "Shape (Image Contour) 노드({0})에 베이크된 외곽선 데이터가 없습니다. 이미지를 업로드하세요.": "Shape (Image Contour) node ({0}) has no baked outline data. Upload an image.",
  "Shape · 3D 배치": "Shape · 3D placement",
  "Shape 노드({0}) 수식 오류: {1}": "Shape node ({0}) formula error: {1}",
  "Simplex (Perlin 개선형 · 방향성 아티팩트 적음)": "Simplex (improved Perlin · fewer directional artifacts)",
  "Sphere (반경)": "Sphere (radius)",
  "Sub Emitter가 포함된 그래프라 파일이 {0}개로 나뉘어 생성되었습니다.": "The graph includes a Sub Emitter, so it was exported as {0} files.",
  "Sub Emitter는 Emitter와 동일하지만 입력에 bone 소켓이 있습니다. 상류 Emitter/Sub Emitter의 bone 출력을 여기에 연결하면 그 값을 그대로 물려받고(연결시 위 텍스트필드는 무시), 미연결이면 위 텍스트필드 값을 자체 bone 이름으로 씁니다. 이 Sub Emitter는 반드시 Event 노드의 fire 출력을 통해서만 발동합니다 — 독립적으로는 재생되지 않고, 별도의 particle_effect JSON으로 추출됩니다(부모와 다른 identifier).": "A Sub Emitter works like an Emitter but has a bone input socket. Connect the bone output of an upstream Emitter/Sub Emitter to inherit that value (the text field above is then ignored); if nothing is connected, the text field is used as its own bone name. A Sub Emitter only plays when fired through an Event node's fire output — it never plays on its own, and it is exported as a separate particle_effect JSON (with its own identifier).",
  "Sub Emitter에 복사할 값 (pre_effect_expression)": "Values to copy to the Sub Emitter (pre_effect_expression)",
  "Sub Emitter와, 1000개 초과로 자동 분할된 이미터(⇢ 표시)가 함께 있어 파일이 {0}개로 나뉘어 생성되었습니다. 분할된 파일은 원본 소환 시 자동으로 함께 소환됩니다.": "The graph has a Sub Emitter and an emitter split for having more than 1000 particles (marked ⇢), so it was exported as {0} files. The split files are spawned automatically with the original.",
  "Turbulence(다중 옥타브 Curl Noise): Curl Noise 한 겹으로는 한 가지 크기의 소용돌이만 나오지만, 이 노드는 fbm과 동일한 방식으로 여러 옥타브를 겹친다 — 옥타브마다 좌표 스케일이 lacunarity배씩 커지고(작은 소용돌이가 추가됨), 기여도는 gain배씩 줄어든다(디테일이 과하게 튀지 않도록). Houdini POP Turbulence, Unity VFX Graph \"Turbulence\" Block과 동일한 개념으로, 단일 Curl Noise보다 훨씬 복잡하고 자연스러운 연기·구름·불꽃 움직임을 낸다. octaves를 늘릴수록 Molang 연산량도 그만큼 늘어나므로(옥타브당 curl 계산 1회, 즉 perlin 6회 호출) 모바일 성능을 고려해 2~4 정도를 권장. 출력 force.x/y/z를 Formula로 위치에 더해서 사용한다.": "Turbulence (multi-octave Curl Noise): a single Curl Noise layer only gives swirls of one size; this node stacks several octaves the same way fbm does — each octave scales the position by lacunarity× (adding smaller swirls) and contributes gain× less (so details don't overpower). Same idea as Houdini POP Turbulence and the Unity VFX Graph \"Turbulence\" block; it gives much richer, more natural smoke, cloud and flame motion than a single Curl Noise. More octaves means proportionally more Molang work (one curl per octave = 6 Perlin calls), so 2–4 is recommended for mobile. Add the force.x/y/z outputs to a position with a Formula.",
  "UV 좌표/크기는 Output 노드의 uv.u / uv.v / uv_size.w / uv_size.h 소켓에서 수식으로 조작합니다(위 texture_width/height 텍셀 기준). r1/r2/rs 같은 반지름 파라미터는 더 이상 여기 없습니다 — Shape 노드의 수식 안에 직접 숫자로 들어갑니다.": "UV position and size are set with formulas on the Output node's uv.u / uv.v / uv_size.w / uv_size.h sockets (measured in texels of the texture_width/height above). Radius parameters like r1/r2/rs are no longer here — they are written as numbers directly inside the Shape node's formulas.",
  "Vector Field (Image) 노드({0}): 그리드 {1}칸이 삼항 상한({2})을 초과해 저주파 근사(fourier)로 자동 전환되었습니다. 정확한 룩업을 쓰려면 베이킹 해상도를 낮추거나 상한을 올리세요.": "Vector Field (Image) node ({0}): the grid's {1} cells exceed the ternary limit ({2}), so it switched to the low-frequency approximation (fourier). To use the exact lookup, lower the bake resolution or raise the limit.",
  "Vector Field (Image) 노드({0})에 아직 이미지가 업로드되지 않았습니다 — 힘이 0으로 출력됩니다.": "No image has been uploaded to Vector Field (Image) node ({0}) yet — its force output is 0.",
  "Voronoi(Worley/Cellular) 노이즈: 무작위로 흩뿌려진 \"씨앗점\"까지의 최단거리로 값을 만든다 — 균열, 비늘, 돌·용암 표면, 거품 질감에 표준적으로 쓰인다.": "Voronoi (Worley/Cellular) noise: the value is the distance to the nearest randomly scattered \"seed point\" — the standard look for cracks, scales, stone or lava surfaces and foam.",
  "Voronoi/Cellular (균열·비늘·돌 질감)": "Voronoi/Cellular (cracks, scales, stone)",
  "Vortex Field(물리 모델): 축 둘레의 흐름 속도장 u(회전 + inward pull만큼의 유입, 코어 반경 안에서는 0으로 부드럽게 수렴)를 정의하고, 입자 가속도를 F = k·(u − w·v) + a_c 로 계산한다(k=drag, w=반경 윈도우, a_c=흐름과 함께 도는 입자에 필요한 구심 가속 u_θ²/r). 구심 가속 덕분에 입자가 원심력으로 퍼지지 않고, inward pull>0이면 나선을 그리며 중심으로 모인다. 위치를 Accumulate(속도→위치)로 적분하는 그래프에서는 속도 Accumulate의 출력을 vel.x/y/z에 연결하면 입자가 흐름 속도에 수렴한다(미연결이면 v=0 가정). 출력 force.x/y/z를 속도 Accumulate의 in에 연결해 사용한다.": "Vortex Field (physics model): defines a flow velocity field u around the axis (rotation plus inflow set by inward pull, easing smoothly to 0 inside the core radius) and computes particle acceleration as F = k·(u − w·v) + a_c (k = drag, w = radius window, a_c = the centripetal acceleration u_θ²/r a particle needs to circle with the flow). Thanks to the centripetal term, particles are not flung outward, and with inward pull > 0 they spiral into the center. In a graph that integrates position with Accumulate (velocity → position), connect the velocity Accumulate's output to vel.x/y/z so particles settle onto the flow speed (if not connected, v = 0 is assumed). Connect the force.x/y/z outputs to the velocity Accumulate's in.",
  "Wall · 벽": "Wall · collision",
  "Wind Zone: Directional Force에 \"영향 범위\"를 더한 노드(Unity \"Wind Zone\" 컴포넌트, Unreal Niagara의 볼륨 제한 Wind Force와 동일 개념). 중심(cx,cy,cz) 기준 Box(축별 반너비 halfX/Y/Z) 또는 Sphere(radius) 영역 밖에서는 힘이 0이 되고, 안쪽에서는 falloff에 따라 경계로 갈수록 부드럽게 약해진다. 창틈으로 들어오는 국소 바람, 특정 방/구역에서만 부는 돌풍처럼 \"장소가 제한된 바람\"을 표현할 때 Directional Force보다 적합하다. turbulence를 0보다 크게 주면 일정한 방향에 Curl Noise를 섞어 흔들리는 돌풍 느낌을 더할 수 있다(1에 가까울수록 방향이 거의 난류로만 결정됨). strength 소켓에 Formula(t)를 연결하면 더 자유로운 시간 변조도 가능하다.": "Wind Zone: Directional Force plus an \"area of effect\" (same idea as Unity's \"Wind Zone\" component and Unreal Niagara's volume-limited Wind Force). Outside the Box (half-sizes halfX/Y/Z) or Sphere (radius) around the center (cx, cy, cz) the force is 0; inside, it fades smoothly toward the edge according to falloff. Better than Directional Force for \"wind in one place only\", like a draft through a window or a gust in a single room. Set turbulence above 0 to mix Curl Noise into the direction for a wavering gust (closer to 1 = direction is almost pure turbulence). Connect a Formula(t) to the strength socket for any time-based variation.",
  "[{0}] {1}": "[{0}] {1}",
  "ambient (주변 온도 T_ambient)": "ambient (surrounding temperature T_ambient)",
  "amplitude (세기)": "amplitude (strength)",
  "amplitude (입력, 선택)": "amplitude (input, optional)",
  "amplitude (전체 힘 세기)": "amplitude (overall force strength)",
  "amplitude (힘 세기)": "amplitude (force strength)",
  "amplitude 소켓이 연결됨 — 위 필드 대신 연결된 값을 사용합니다.": "The amplitude socket is connected — its value is used instead of the field above.",
  "auto (6면 벽이 루프에 있으면 grid, 없으면 end · 권장)": "auto (grid if a 6-sided wall is in the loop, otherwise end · recommended)",
  "auto (지금: {0})": "auto (now: {0})",
  "billboard direction.mode가 custom이지만 Output의 direction.x/y/z 소켓이 연결되어 있지 않습니다.": "billboard direction.mode is custom, but the Output's direction.x/y/z sockets are not connected.",
  "bone (미연결시 기본값)": "bone (default if not connected)",
  "bone (입력)": "bone (input)",
  "burst (rate_instant · 1회 일괄 생성)": "burst (rate_instant · all at once)",
  "cell density (셀 밀도)": "cell density",
  "clamp (min/max에서 멈춤)": "clamp (stop at min/max)",
  "coeff (입력, 선택)": "coeff (input, optional)",
  "coeff 소켓이 연결됨 — 위 필드 대신 연결된 값을 사용합니다.": "The coeff socket is connected — its value is used instead of the field above.",
  "core 반경 (축 근처 부드러운 코어)": "core radius (soft core near the axis)",
  "custom · Output direction.x/y/z 소켓 값 사용": "custom · use the Output direction.x/y/z sockets",
  "damping c (점성 감쇠 1/s · ẋ = in − c·x · 속도 노드용 · 0=없음)": "damping c (viscous damping 1/s · ẋ = in − c·x · for velocity nodes · 0 = none)",
  "derive_from_velocity · 속도에서 방향 유도": "derive_from_velocity · direction from velocity",
  "direction_x · x축이 방향 벡터 (direction 필요)": "direction_x · x axis points along the direction vector (needs direction)",
  "direction_y · y축이 방향 벡터 (direction 필요)": "direction_y · y axis points along the direction vector (needs direction)",
  "direction_z · 면이 방향 벡터를 향함 (direction 필요)": "direction_z · face points along the direction vector (needs direction)",
  "drag c (점성 감쇠 1/s · vel 입력 연결 시 작동 · 임계감쇠≈2ω)": "drag c (viscous damping 1/s · works when vel inputs are connected · critical damping ≈ 2ω)",
  "drag coefficient (감쇠 계수)": "drag coefficient",
  "drag k (흐름 결합 1/s · vel 입력 연결 시 흐름을 따라감)": "drag k (flow coupling 1/s · particles follow the flow when vel inputs are connected)",
  "edge smooth (경계 스무딩, 0=칼각)": "edge smooth (0 = sharp edges)",
  "emitter · 그 파티클 위치에 Sub Emitter 생성": "emitter · create the Sub Emitter at that particle's position",
  "emitter_age (이미터 전역 경과시간)": "emitter_age (time since the emitter started)",
  "emitter_age (이미터 전역 시간)": "emitter_age (emitter's global time)",
  "emitter_bound · 발동원이 붙은 로케이터에 생성": "emitter_bound · create it on the source's locator",
  "emitter_transform_xy · 이미터 xy 평면": "emitter_transform_xy · emitter's xy plane",
  "emitter_transform_xz · 이미터 xz 평면": "emitter_transform_xz · emitter's xz plane",
  "emitter_transform_yz · 이미터 yz 평면": "emitter_transform_yz · emitter's yz plane",
  "end (끝 쪽을 잘게 · 정확)": "end (finer steps near the end · accurate)",
  "export 시 자동으로 저주파 근사로 대체": " automatically replaced with the low-frequency approximation on export",
  "facing_camera_mode \"{0}\"는 방향 벡터가 필요합니다. Output의 direction.x/y/z 소켓을 연결하거나, Emitter의 billboard direction.mode를 지정하세요.": "facing_camera_mode \"{0}\" needs a direction vector. Connect the Output's direction.x/y/z sockets, or set the Emitter's billboard direction.mode.",
  "falloff (경계 감쇠 강도 · 0=감쇠없음)": "falloff (how strongly it fades at the edge · 0 = no fade)",
  "fire에 연결된 Sub Emitter 생성 방식": "How the Sub Emitter on fire is created",
  "floor (완전 감쇠 후 남는 바닥값)": "floor (value left after it fully fades)",
  "flow 속도": "Flow speed",
  "flow 시간축": "Flow time axis",
  "fps (초당 프레임)": "fps (frames per second)",
  "gain (옥타브당 진폭 감쇠율)": "gain (amplitude falloff per octave)",
  "grid (고정 시간 격자 · 궤적이 끊기지 않음)": "grid (fixed time grid · trails never break)",
  "gust 시간축": "Gust time axis",
  "gust 주파수 (Hz)": "Gust frequency (Hz)",
  "gust 진폭 비율 (0~1+)": "Gust amount (0–1+)",
  "h (높이)": "h (height)",
  "half-life (반감기 · 이 비율의 t마다 절반으로 감소)": "half-life (halves every half-life of t)",
  "identifier 형식이 올바르지 않습니다(예 ore:my_vfx).": "The identifier format is invalid (e.g. ore:my_vfx).",
  "id·시간에서 매 프레임 다시 계산하는 상태 없는 누적 노드 — out = init + ∫in dt (변수 공유 문제 없음). 회전각·이동거리처럼 \"지금까지 쌓인 값\"에 사용. clamp/wrap/reset 지원": "Adds up a value over time without storing state (recomputed every frame from the particle id and time) — out = init + ∫ in dt. Use it for \"how much has built up so far\", such as spin angle or distance travelled. Supports clamp, wrap and reset",
  "in (초당 증가량 · 미연결시 rate 필드)": "in (increase per second · uses the rate field if not connected)",
  "in 값이 threshold보다 크면 1, 작으면 0(softness>0이면 경계를 smoothstep으로 부드럽게 보간). Shader Graph의 \"Step\"/dissolve 셰이더와 동일한 개념. threshold 소켓에 다른 값(예: Curve의 t 기반 출력)을 연결하면 시간에 따라 기준값이 움직여 노이즈 패턴을 따라 점점 사라지는 dissolve 연출이 가능합니다. 출력을 Output.tint.a에 연결하세요.": "Outputs 1 when in is above threshold and 0 when below (with softness > 0 the edge is blended with smoothstep). Same idea as Shader Graph's \"Step\" / dissolve shaders. Connect another value to the threshold socket (for example a Curve driven by t) to move the cutoff over time, so the effect gradually disappears along the noise pattern — a dissolve. Connect the output to Output.tint.a.",
  "in 미연결시 아래 시간축 기반 자동 사용": "If in is not connected, use the automatic time axis below",
  "init (초기값 · 미연결시 init 필드)": "init (start value · uses the init field if not connected)",
  "init (초기값)": "init (start value)",
  "integrate (in × dt · 초당)": "integrate (in × dt · per second)",
  "inward pull (중심으로 흘러드는 유입 비율 0~1+)": "inward pull (how much flows toward the center, 0–1+)",
  "inward pull이 0보다 크고 orbit radius가 0이면 흐름이 모두 축으로 빨려 들어가, 입자는 축 위의 한 점에 멈춥니다(돌지 않음). 계속 소용돌이치게 하려면 orbit radius를 0보다 크게 주세요 — 입자가 그 반경의 고리로 모인 뒤 거기서 계속 회전합니다.": "If inward pull is above 0 and orbit radius is 0, the flow sucks everything into the axis and particles stop at a point on it (they stop spinning). To keep them swirling, set orbit radius above 0 — particles gather into a ring of that radius and keep rotating there.",
  "lacunarity (옥타브당 스케일 배율)": "lacunarity (scale multiplier per octave)",
  "lacunarity (옥타브당 주파수 배율)": "lacunarity (frequency multiplier per octave)",
  "lookat_direction / direction_x·y·z 모드는 파티클 방향 벡터가 필요합니다. 이 파이프라인은 위치를 particle_motion_parametric으로 직접 지정하므로(속도 0) derive_from_velocity는 방향이 나오지 않습니다 — Output의 direction.x/y/z 소켓에 연결하면 parametric.direction으로 내보내지고, 그 값이 방향 벡터로 쓰입니다. custom을 고르면 같은 값이 billboard direction.custom_direction에도 들어갑니다.": "lookat_direction and direction_x/y/z modes need a particle direction vector. This editor places particles directly with particle_motion_parametric (velocity is 0), so derive_from_velocity produces no direction — connect the Output's direction.x/y/z sockets instead: they are exported as parametric.direction and used as the direction vector. If you choose custom, the same value also goes into the billboard's direction.custom_direction.",
  "lookat_direction · 방향 벡터 축 + 카메라 조준 (direction 필요)": "lookat_direction · direction-vector axis + aims at the camera (needs direction)",
  "lookat_xyz · 카메라를 조준, 위쪽 편향": "lookat_xyz · aims at the camera, biased upward",
  "lookat_y · 카메라 조준, Y축 회전만": "lookat_y · aims at the camera, Y rotation only",
  "loop (반복 재생)": "loop (repeat)",
  "max (출력 상한 · clamp/wrap일 때)": "max (upper limit · for clamp/wrap)",
  "max_particles (동시 최대 수 · ≤1000)": "max_particles (most alive at once · ≤1000)",
  "min (출력 하한 · clamp/wrap일 때)": "min (lower limit · for clamp/wrap)",
  "octaves (겹치는 레이어 수)": "octaves (number of layers)",
  "octaves (겹칠 옥타브 수 · 많을수록 디테일↑연산↑)": "octaves (layers to stack · more = more detail, more work)",
  "once (마지막 프레임에서 정지)": "once (stop on the last frame)",
  "orbit radius r0 (유입이 멈추고 계속 도는 반경 · 0=축까지 빨려듦)": "orbit radius r0 (radius where inflow stops and particles keep circling · 0 = pulled all the way to the axis)",
  "out (상수)": "out (constant)",
  "pack_icon.png (256×256으로 맞춤)": "pack_icon.png (resized to 256×256)",
  "particle 타입 이벤트는 미리보기에서 재생하지 않음": "particle-type events are not played in the preview",
  "particle_age (개별 파티클 생존시간)": "particle_age (each particle's own age)",
  "particle_age (파티클 개별 시간 · 권장)": "particle_age (each particle's own time · recommended)",
  "particle_effect 블록이 없습니다.": "There is no particle_effect block.",
  "particle_lifetime (age≥값이면 kill)": "particle_lifetime (kill when age ≥ this value)",
  "per-frame (in을 60fps 프레임 단위로 환산)": "per-frame (in counted per 60 fps frame)",
  "pingpong (왕복 재생)": "pingpong (back and forth)",
  "position · 엔티티 공간에서 시뮬레이션": "position · simulate in entity space",
  "pulse 시간축": "Pulse time axis",
  "pulse 주파수 (Hz)": "Pulse frequency (Hz)",
  "pulse 진폭 비율 (0~1+)": "Pulse amount (0–1+)",
  "radius (영향 반경 · 0 = 무제한)": "radius (area of effect · 0 = unlimited)",
  "radius (영향 반경)": "radius (area of effect)",
  "radius (입력, 선택)": "radius (input, optional)",
  "radius 소켓이 연결됨 — 위 필드 대신 연결된 값을 사용합니다.": "The radius socket is connected — its value is used instead of the field above.",
  "rate (입력, 선택)": "rate (input, optional)",
  "rate (초당 증가량)": "rate (increase per second)",
  "rate 소켓이 연결됨 — 위 half-life 대신 연결된 값을 감쇠율로 직접 사용합니다(rate가 클수록 빠르게 감쇠).": "The rate socket is connected — its value is used directly as the decay rate instead of half-life (higher rate = faster decay).",
  "reset (0/1 · 선택)": "reset (0/1 · optional)",
  "rotate_xyz · 카메라 정면 (기본)": "rotate_xyz · faces the camera (default)",
  "rotate_y · 카메라 향함, 월드 Y축 회전만": "rotate_y · faces the camera, rotates around world Y only",
  "rotation (도° · 매 프레임)": "rotation (degrees · every frame)",
  "rotation · 엔티티 회전 따라가기 (position 필요)": "rotation · follow the entity's rotation (needs position)",
  "samples N (적분 분할 수 · 1~32 · 식 길이 ×N)": "samples N (integration steps · 1–32 · formula length × N)",
  "scale (기본 소용돌이 크기)": "scale (base swirl size)",
  "scale (벡터장 스케일 · 소용돌이 크기)": "scale (field scale · size of the swirls)",
  "scale (입력, 선택)": "scale (input, optional)",
  "scale (좌표 스케일)": "scale (coordinate scale)",
  "scale 소켓이 연결됨 — 위 필드 대신 연결된 값을 사용합니다.": "The scale socket is connected — its value is used instead of the field above.",
  "seed 복사": "Copy seed",
  "softening ε (중심 특이점 제거 길이)": "softening ε (length that removes the spike at the center)",
  "softness (경계 부드러움, 0=칼같은 경계)": "softness (edge softness, 0 = hard edge)",
  "spawn_rate (초당 생성 수)": "spawn_rate (particles per second)",
  "speed (순환 오프셋 진행 속도 배수)": "speed (multiplier for how fast the offset moves)",
  "start (t=0에서의 시작값)": "start (value at t = 0)",
  "steady (rate_steady · 지속 생성)": "steady (rate_steady · continuous)",
  "strength (미연결시 이 값 사용)": "strength (used when not connected)",
  "strength (바람 세기)": "strength (wind strength)",
  "strength (양수=끌어당김, 음수=밀어냄)": "strength (positive = pull in, negative = push away)",
  "strength (입력, 선택)": "strength (input, optional)",
  "strength (회전 힘 · 음수=반대방향)": "strength (spin force · negative = opposite direction)",
  "strength 소켓이 연결됨 — 위 필드 대신 연결된 값을 사용합니다.": "The strength socket is connected — its value is used instead of the field above.",
  "strength가 1+pulseAmount·sin(2π·freq·t) 배로 주기적으로 커졌다 작아집니다 — 맥동하는 태풍/소용돌이 연출.": "strength rises and falls periodically by a factor of 1 + pulseAmount·sin(2π·freq·t) — for a throbbing storm or whirlpool.",
  "strength가 1+pulseAmount·sin(2π·freq·t) 배로 주기적으로 커졌다 작아집니다 — 심장박동처럼 맥동하는 인력/척력 연출.": "strength rises and falls periodically by a factor of 1 + pulseAmount·sin(2π·freq·t) — for an attraction or repulsion that beats like a heart.",
  "strength가 주기적으로 세졌다 약해집니다 — 일정하게 불다가 간간이 강해지는 돌풍 연출.": "strength gets stronger and weaker periodically — steady wind with occasional strong gusts.",
  "t (0~1, 미연결시 자동)": "t (0–1, automatic if not connected)",
  "t (0~1, 입력 · 미연결시 emitter_age 기반 자동)": "t (0–1, input · automatic from emitter_age if not connected)",
  "t (시간, 입력 · 미연결시 자동)": "t (time, input · automatic if not connected)",
  "t = (v.emitter_age / 기준길이). v.emitter_age는 이미터가 켜진 뒤 리셋 없이 전역으로 계속 흐르는 실제 경과 시간(초) — 개별 파티클 나이와 무관하게 이펙트 전체가 같은 진행도를 공유한다.": "t = v.emitter_age / reference length. v.emitter_age is the real time in seconds since the emitter turned on, never reset — the whole effect shares the same progress regardless of each particle's age.",
  "t = (v.particle_age / 기준길이). v.particle_age는 개별 파티클이 태어난 뒤 흐르는 생존시간(초) — v5부터 실제 생존시간을 의미하므로 유효하다. 파티클마다 각자 태어난 시점 기준으로 커브가 재생된다(Unity의 \"Curve over Lifetime\"과 동일한 개념).": "t = v.particle_age / reference length. v.particle_age is the time in seconds since each particle was born — valid since v5, where it means each particle's real age. The curve plays from each particle's own birth (same idea as Unity's \"Curve over Lifetime\").",
  "t 미연결시 자동으로 시간축 사용": "If t is not connected, use the time axis automatically",
  "t 시간축": "t time axis",
  "t 입력(0~1)에 따라 정지점 색을 보간해 r/g/b를 출력. ea(v.emitter_age)로 만든 0~1 진행도를 t에 연결하면 이미터가 켜진 뒤 시간에 따라 색이 자연스럽게 변한다(Unity/Houdini의 Color Gradient·Ramp와 동일 개념). 출력을 Output.tint(r/g/b)에 바로 연결하세요.": "Blends the stop colors according to the t input (0–1) and outputs r/g/b. Connect a 0–1 progress made from ea (v.emitter_age) to t and the color changes smoothly over time after the emitter starts (same idea as Color Gradient/Ramp in Unity and Houdini). Connect the outputs straight to Output.tint (r/g/b).",
  "t 입력이 연결되어 있어 아래 fps/재생방식은 무시되고, 연결된 값(0~1)을 그대로 재생 진행도로 사용합니다.": "The t input is connected, so fps and playback mode below are ignored and the connected value (0–1) is used directly as the playback progress.",
  "temperature (입력, 선택 · 미연결시 emitter_age 기반 자동)": "temperature (input, optional · automatic from emitter_age if not connected)",
  "temperature 미연결시: 아래 시간축 기반 자동 온도 사용": "If temperature is not connected: use an automatic temperature from the time axis below",
  "temperature 소켓이 연결됨 — 연결된 값을 온도로 사용합니다. (temperature-ambient)가 양수면 방향으로, 음수면 반대로 힘이 걸립니다.": "The temperature socket is connected — its value is used as the temperature. If (temperature − ambient) is positive the force points along the direction; if negative, the opposite way.",
  "temperature 입력도 없고 emitter_age 기반 자동도 꺼져 있으면 temperature=ambient로 취급되어 힘이 항상 0입니다. temperature 소켓을 연결하거나 emitter_age 기반 자동을 켜세요.": "With no temperature input and the automatic emitter_age mode turned off, temperature = ambient, so the force is always 0. Connect the temperature socket or turn on the automatic mode.",
  "texture_height (UV 텍셀 기준높이)": "texture_height (texels, used for UV)",
  "texture_width (UV 텍셀 기준폭)": "texture_width (texels, used for UV)",
  "threshold (기준값)": "threshold (cutoff)",
  "threshold (이진화 기준, 0~1)": "threshold (black/white cutoff, 0–1)",
  "threshold (입력, 선택)": "threshold (input, optional)",
  "turbulence (방향을 Curl Noise로 흔드는 비율 0~1)": "turbulence (how much Curl Noise wobbles the direction, 0–1)",
  "turbulence(방향 흔들림)와 별개로 strength 자체가 주기적으로 세졌다 약해집니다 — 둘을 함께 켜면 방향도 흔들리고 세기도 오르내리는 자연스러운 돌풍이 됩니다.": "Separately from turbulence (direction wobble), strength itself rises and falls periodically — with both on, the direction wavers and the strength surges for natural-looking gusts.",
  "t를 Vortex/Attractor/Directional 등 벡터장 노드의 strength·radius 입력에 연결하면 시간에 따라 세기가 변하는 힘을 만들 수 있습니다 — Unity VFX Graph의 Time Operator, Unreal Niagara의 Engine Time 모듈과 동일한 역할.": "Connect t to the strength or radius input of a field node (Vortex, Attractor, Directional…) to make a force that changes over time — the same role as Unity VFX Graph's Time operator and Unreal Niagara's Engine Time module.",
  "uniform (균등 분할 · v1.0 방식)": "uniform (even steps · v1.0 behavior)",
  "v.emitter_age에 비례해 매 프레임 연속적으로 증가(리셋 없이 계속 증가)되어 노이즈 샘플링 좌표 p(x,y,z)에 더해짐. 세대/파티클 교체와 무관하게 항상 매끄럽게 흐름. 실제 누적량 = emitter_age × cycleOffsetStep × speed.": "Grows continuously every frame with v.emitter_age (never resets) and is added to the noise sampling position p(x,y,z). Always flows smoothly, regardless of particle replacement. Total amount = emitter_age × cycleOffsetStep × speed.",
  "v.이름": "v.name",
  "value (숫자 또는 v.이름)": "value (a number or v.name)",
  "vel.x (입력, 선택)": "vel.x (input, optional)",
  "vel.y (입력, 선택)": "vel.y (input, optional)",
  "vel.z (입력, 선택)": "vel.z (input, optional)",
  "velocity · 엔티티 속도를 초기 속도에 더함": "velocity · add the entity's velocity to the start velocity",
  "wrap (min~max 순환)": "wrap (loop between min and max)",
  "x/y/z 입력에 다른 노드(Noise 3D 등)가 연결됨 — 미리보기가 그 노드의 현재 값을 실제로 계산해 반영합니다(직접 값 입력은 무시됨).": "Another node (such as Noise 3D) is connected to x/y/z — the preview really evaluates that node's current value (typed values are ignored).",
  "xzScale (윤곽선 전체 크기, 월드 단위)": "xzScale (overall outline size, in blocks)",
  "y = (높이 수식 · 기본 0=평면)": "y = (height formula · default 0 = flat)",
  "{0} ({1}가 emitterDuration을 넘으면 0에서 유지) · ambient는 이 모드에서 사용되지 않습니다(항상 0 기준).": "{0} (stays at 0 once {1} passes emitterDuration) · ambient is not used in this mode (always measured from 0).",
  "{0} / {1}": "{0} / {1}",
  "{0} 루프는 나머지(mod)로 0→1을 계속 반복, 1회성은 0~1로 clamp해서 한 번만 재생하고 끝값에 머문다.": "{0} Loop repeats 0 → 1 forever using modulo; Once clamps to 0–1, plays one time and stays on the last value.",
  "{0} 모드에 방향 벡터가 없습니다.": "{0} mode has no direction vector.",
  "{0} 벽별 범위·반동 편집": "{0} Edit each wall's range and bounce",
  "{0} 위 탭에서 각 파일을 선택해 복사/다운로드하세요. {1}{2}{3} 파일 전부를 리소스팩의 particles 폴더에 함께 저장해야 정상 작동합니다.": "{0} Pick each file in the tabs above to copy or download it. {1}{2}{3} All the files must be saved together in the resource pack's particles folder for it to work.",
  "{0}() 닫는 괄호 누락": "{0}(): missing closing parenthesis",
  "{0}({1}) 식별자 \"{2}\": {3}": "{0} ({1}) identifier \"{2}\": {3}",
  "{0}({1})에 연결된 Output 노드가 없습니다.": "{0} ({1}) is not connected to an Output node.",
  "{0}개": "{0} nodes",
  "{0}개 복사": "Copied {0}",
  "{0}개 붙여넣음{1}": "Pasted {0}{1}",
  "{0}개 삭제": "Deleted {0}",
  "{0}개 선택": "{0} selected",
  "{0}개 파티클이 원점에서 500블록 이상 벗어남": "{0} particles moved more than 500 blocks from the origin",
  "{0}차 하모닉{1}": "{0} harmonics{1}",
  "· 구움 완료": "· baked",
  "· 덩어리 {0}개(둘레비례 분배)": "· {0} shapes (split by perimeter)",
  "· 추출 완료(": "· Traced (",
  "· 추출 완료({0}": "· Traced ({0}",
  "· 추출 완료({0}개 덩어리,": "· Traced ({0} shapes,",
  "· 추출 완료({0}개 덩어리, {1}": "· Traced ({0} shapes, {1}",
  "· 추출 완료({0}개 덩어리, {1}차 하모닉)": "· Traced ({0} shapes, {1} harmonics)",
  "— 선택 —": "— choose —",
  "ⓘ 설명 닫힘": "ⓘ Descriptions hidden",
  "ⓘ 설명 열림": "ⓘ Descriptions shown",
  "▲ 위": "▲ Up",
  "▶ ALL · 메인 이미터부터 전체 재생": "▶ ALL · play everything, starting from the main emitter",
  "▶ 프리뷰": "▶ Preview",
  "▸ 자세히 설정": "▸ Advanced settings",
  "▼ 아래": "▼ Down",
  "▾ 자세히 설정 닫기": "▾ Hide advanced settings",
  "◀ 좌": "◀ Left",
  "⚠ v.{0} 은(는) 에디터/마인크래프트가 쓰는 이름이라 사용할 수 없습니다. 다른 이름을 쓰세요.": "⚠ v.{0} is a name used by the editor or Minecraft, so it can't be used. Choose another name.",
  "⚠ {0}×{1}={2}칸 — 베이킹(이미지 축소+저주파 피팅)이 브라우저에서 수 초 이상 걸리거나 일시적으로 멈춘 것처럼 보일 수 있습니다. 근사(fourier) 모드는 해상도가 커도 export 결과 자체는 여전히 짧지만, 베이킹 자체의 체감 속도는 느려집니다.": "⚠ {0}×{1} = {2} cells — baking (shrinking the image and fitting low frequencies) may take several seconds in the browser or look frozen for a moment. In approximate (fourier) mode the exported result stays short even at high resolution, but baking itself gets slower.",
  "⚠ 추출할 JSON이 없습니다. Emitter와 Output이 연결된 그래프인지 확인하세요.": "⚠ Nothing to export. Make sure the graph connects an Emitter to an Output.",
  "⚠ 현재 그리드는 셀 {0}개(=삼항 최대 {1}개) — 상한({2})을 초과해서": "⚠ The current grid has {0} cells (= up to {1} ternaries) — that is over the limit ({2}), so it is ",
  "⚡ {0}: {1}": "⚡ {0}: {1}",
  "⚡ 최적화 OFF": "⚡ Optimize OFF",
  "⚡ 최적화 ON": "⚡ Optimize ON",
  "✎ 이름 바꾸기": "✎ Rename",
  "✕ 탭 닫기": "✕ Close tab",
  "⧉ 탭 복제": "⧉ Duplicate tab",
  "가 켜진 뒤 식어가는 전역 시간축입니다. 개별 파티클 나이와 무관하게 이펙트 전체가 emitterDuration 동안 뜨거웠다가 식습니다.": " cools down on a global time axis that starts when the emitter turns on. The whole effect stays hot and cools over emitterDuration, regardless of each particle's age.",
  "가장 가까운 면": "Nearest face",
  "가장 가까운 면 (박스 6면 모두 · 피드백용)": "Nearest face (all 6 faces of the box · for feedback loops)",
  "감쇠 방식": "Falloff type",
  "개": "nodes",
  "개 덩어리,": "shapes,",
  "개 파티클이 원점에서 500블록 이상 벗어남": "particles moved more than 500 blocks from the origin",
  "개별 파티클": "Each particle ",
  "검사 통과: 구조·Molang 문법·변수·평가값 이상 없음": "Check passed: structure, Molang syntax, variables and evaluated values all OK",
  "검색… (Enter: 첫 항목 추가)": "Search… (Enter adds the first match)",
  "검증 실패:": "Validation failed:",
  "검증 실패: {0}": "Validation failed: {0}",
  "게임에서 값을 넣는 변수: v.": "Variable set by the game: v.",
  "게임에서 값을 넣는 변수: v.{0}": "Variable set by the game: v.{0}",
  "게임에서 값을 넣는 변수: v.{0} (미리보기 값": "Variable set by the game: v.{0} (preview value",
  "게임에서 값을 넣는 변수: v.{0} (미리보기 값 {1}": "Variable set by the game: v.{0} (preview value {1}",
  "게임에서 값을 넣는 변수: v.{0} (미리보기 값 {1})": "Variable set by the game: v.{0} (preview value {1})",
  "고정 반지름 원형 링": "Circular ring with a fixed radius",
  "괄호 짝이 맞지 않습니다 ({0})": "Unbalanced parentheses ({0})",
  "구 (Sphere)": "Sphere",
  "구운 벡터장 미리보기": "Baked field preview",
  "그래프 다시 컴파일": "Recompile the graph",
  "그래프 밖의 이펙트는 재생하지 않음:": "Effects outside the graph are not played:",
  "그래프 밖의 이펙트는 재생하지 않음: {0}": "Effects outside the graph are not played: {0}",
  "그래프를 모두 초기화할까요?": "Clear the whole graph?",
  "그래프를 탭하면 포인트 추가, 드래그로 이동, 포인트를 길게 눌러 삭제(최소 2개 유지)합니다.": "Tap the graph to add a point, drag to move it, and long-press a point to delete it (at least 2 points stay).",
  "그래프에 순환 참조가 있습니다(노드 {0} ↔ {1} 근방). 연결을 확인하세요.": "The graph has a circular reference (near nodes {0} ↔ {1}). Check the connections.",
  "그리드 (columns × rows)": "Grid (columns × rows)",
  "극한": "Max",
  "극한: 대수 재배열·공통인수·삼각 항등식까지 / 안전: 비트 동일 변환만 (둘 다 식 단위 수치검증 통과분만 적용)": "Max: also rearranges algebra, factors out common terms and uses trig identities / Safe: only bit-identical rewrites (either way, only changes that pass a per-formula numeric check are applied)",
  "근사 항 개수 (많을수록 정확 · sin+cos 쌍)": "Approximation terms (more = more accurate · sin+cos pairs)",
  "기본 구성: Emitter → Shape → Output (Emitter의 j·n·h·seed를 Shape에, Shape의 x·y·z를 Output의 offset에 연결)": "Basic setup: Emitter → Shape → Output (connect the Emitter's j·n·h·seed to the Shape, and the Shape's x·y·z to the Output's offset)",
  "기준 길이(초) · 이 시간 동안 0→1": "Reference length (s) · goes 0 → 1 over this time",
  "기준 길이(초) · 이 시간 동안 커브 0→1": "Reference length (s) · the curve goes 0 → 1 over this time",
  "기타… ({3}: {4})": "More… ({3}: {4})",
  "나선형 (Spiral)": "Spiral",
  "나이 {0}s {1}": "age {0}s {1}",
  "나이 {1}s {2} 위치 {3} {4}크기 {5} 색상 {6} UV {7}": "age {1}s {2} position {3} {4}size {5} color {6} UV {7}",
  "내보내기": "Export",
  "내보내기/프리뷰 시 Molang 수식 최적화": "Optimize Molang formulas when exporting and previewing",
  "내보내기에는 v.이름만 들어갑니다": "Only v.name goes into the export",
  "내보낼 파티클이 없습니다.": "There are no particles to export.",
  "내부 오류: 분산 이미터 분할 후에도 로컬 count({0})가 1000을 초과했습니다.": "Internal error: after splitting into extra emitters, a local count ({0}) is still above 1000.",
  "노드 {0}": "Nodes {0}",
  "노드 검색… (이름·기능)": "Search nodes…",
  "노드 라이브러리(왼쪽/아래 팔레트)에서 Emitter 노드부터 배치하세요. 데스크톱은 빈 곳을 우클릭해도 됩니다.": "Start by placing an Emitter node from the Node Library (left side, or bottom on mobile). On desktop you can also right-click an empty spot.",
  "노드 위에 마우스를 올리면 설명이 표시됩니다.": "Hover over a node to see its description.",
  "노이즈 샘플링 좌표가 v.emitter_age에 비례해 매 프레임 연속적으로 회전 — 파티클이 교체되어도 끊김 없이 부드럽게 이어짐(세대 단위 계단식 아님). 회전축은 기본 Y축(0,1,0)에서 X기울기→Y기울기 순으로 틀어서 결정(둘 다 0이면 기존과 동일한 순수 Y축 회전). 실제 누적량 = emitter_age × rotateStep × speed.": "The noise sampling coordinates rotate continuously every frame in step with v.emitter_age — smooth even when particles are replaced (not in steps per generation). The axis starts as the Y axis (0,1,0) and is tilted by X, then Y (both 0 = plain Y-axis rotation, as before). Total amount = emitter_age × rotateStep × speed.",
  "노이즈 샘플링 좌표가 시간에 따라 한 축으로 계속 이동해, 고정된 패턴이 아니라 살아있는 듯 흐르는 난류가 됩니다 — Unity VFX Graph \"Curl Noise\"의 Time 입력과 동일한 개념.": "The noise sampling position keeps moving along one axis over time, so instead of a frozen pattern you get turbulence that flows as if alive — the same idea as the Time input of Unity VFX Graph \"Curl Noise\".",
  "노이즈 종류": "Noise type",
  "누적 방식": "Accumulation mode",
  "다시 실행": "Redo",
  "다시 실행 (Ctrl+Shift+Z)": "Redo (Ctrl+Shift+Z)",
  "다음 탭에 오류가 있어 내보내지 못했습니다:": "These tabs have errors and could not be exported:",
  "다음 탭에 오류가 있어 내보내지 못했습니다: {0}": "These tabs have errors and could not be exported: {0}",
  "다중 옥타브 힘 벡터장 미리보기": "Multi-octave force field preview",
  "단계에서 멈춤": "stopped at step",
  "닫기": "Close",
  "닫는 괄호 누락": "Missing closing parenthesis",
  "덩어리 {0}개 발견 → 둘레 비례 파티클 분배: {1}": "Found {0} shapes → particles split by perimeter: {1}",
  "동작 방식: 파티클은 rate_instant로 한 번만 태어나고, 위치는 particle_motion_parametric 수식으로 매 프레임 직접 계산됩니다(재생성 없음). max_lifetime=1000000+id*100+99에 파티클 고유 id(정수 그대로·양자화 없음)를 담아 두고, 파티클마다 tint/size/위치를 매 프레임 다시 계산합니다. 위 수명(초)이 되면 이미터의 kill 이벤트가 발동해 이펙트 전체가 정리됩니다.": "How it works: particles are born once with rate_instant, and their position is computed directly every frame by a particle_motion_parametric formula (no respawning). Each particle's own id (an exact integer, no quantization) is stored in max_lifetime = 1000000 + id×100 + 99, and every particle recomputes its tint, size and position each frame. When the lifetime (s) above is reached, the emitter's kill event fires and the whole effect is cleaned up.",
  "되돌리기": "Undo",
  "되돌리기 (Ctrl+Z)": "Undo (Ctrl+Z)",
  "됩니다. Bedrock은 지나치게 깊게 중첩된 삼항 체인에서 파싱 오류·크래시가 보고된 바 있어, 상한을 넘으면 안전한 방식으로 자동 전환합니다. 정확한 룩업을 쓰려면 베이킹 해상도를 낮추거나 상한을 올리세요.": ". Bedrock has had reports of parse errors and crashes with very deeply nested ternary chains, so above the limit it switches to the safe method. To use the exact lookup, lower the bake resolution or raise the limit.",
  "뒤": "Back",
  "드래그해서 크기 조절": "Drag to resize",
  "랜덤 구름 (Random Cloud)": "Random Cloud",
  "로케이터에 붙여 쓰기 (emitter_local_space)": "Attach to a locator (emitter_local_space)",
  "루프 (기준 길이마다 0→1 반복 재생)": "Loop (repeat 0 → 1 every reference length)",
  "링 (Ring)": "Ring",
  "마스크 경계 흐름": "Flow along mask edges",
  "마인크래프트 변수": "Reads the Minecraft variable ",
  "마찰력 (0~1 · 원점 쪽 면 방식에서만)": "Friction (0–1 · face-toward-origin mode only)",
  "마찰력 (0~1)": "Friction (0–1)",
  "매핑 영역 크기(월드 단위, 정사각형 한 변)": "Mapped area size (in blocks, one side of the square)",
  "머테리얼": "Material",
  "명칭 (에디터 표시용)": "Display name (editor only)",
  "모드에 방향 벡터가 없습니다.": "mode has no direction vector.",
  "모든 노드 설명 열기/닫기": "Show/hide all node descriptions",
  "모든 옥타브의 노이즈 샘플링 좌표가 함께 시간에 따라 흘러, 정지된 패턴이 아니라 실시간으로 소용돌이치는 연기/구름처럼 보입니다.": "The sampling position of every octave flows together over time, so it looks like smoke or clouds swirling live instead of a frozen pattern.",
  "미리보기 값 (에디터에서만 사용)": "Preview value (editor only)",
  "미리보기 화살표 밀도(셀 px · 작을수록 촘촘)": "Preview arrow spacing (px per cell · smaller = denser)",
  "바람 방향 (dirX, dirY, dirZ)": "Wind direction (dirX, dirY, dirZ)",
  "박스(min/max) 벽에 부딪혀 튕기는 위치 보정 — 입력 x/y/z → 출력 x/y/z. 벽마다 마찰력·반동(슬라임 블록처럼) 지정, 눈 아이콘으로 3D 프리뷰에 벽 표시. Shape/Noise 등의 위치 출력과 Output offset 사이에 끼워 쓰세요.": "Keeps particles inside box walls (min/max) and bounces them off — input x/y/z → output x/y/z. Set friction and bounce per wall (bouncy like a slime block); the eye icon shows the walls in the 3D preview. Place it between a position output (Shape, Noise…) and the Output offset.",
  "반감기(half-life) 기반 지수 감쇠 → out 출력. 연기 밀도·온도·알파가 시간이 지나며 옅어지는 현상(D_t+1=D_t·(1-α·Δt))을 표현. tint.a나 size에 연결하면 자연스럽게 사라지는 연기/불씨 효과. 자동 시간축은 emitter_age(전역 경과시간)/particle_age(개별 생존시간, v5부터 유효) 중 선택 가능": "Exponential fade based on a half-life → outputs out. Models smoke density, heat or alpha thinning out over time (D_t+1 = D_t·(1 − α·Δt)). Connect it to tint.a or size for smoke and embers that fade naturally. The automatic time axis can be emitter_age (time since the emitter started) or particle_age (each particle's own age)",
  "반너비 (halfX, halfY, halfZ)": "Half-size (halfX, halfY, halfZ)",
  "반동 (0~2)": "Bounce (0–2)",
  "반동 (0~2, 1=슬라임)": "Bounce (0–2, 1 = slime)",
  "반동 한계 거리 (자동=-1)": "Bounce limit distance (auto = −1)",
  "반복(mod)": "Repeat (mod)",
  "반전 (안팎 뒤집기)": "Invert (swap inside and outside)",
  "반지름 보간 가능한 실린더/장구형": "Cylinder or hourglass shape (radius can be blended)",
  "발동 시각(초 · 파티클 나이)": "Fire time (s · particle age)",
  "발동 시각(초)": "Fire time (s)",
  "발동 조건": "Fire condition",
  "발동 조건 (파티클마다)": "Fire condition (per particle)",
  "발동 조건(생성/소멸/타임라인) + 복사할 값 선택 → Sub Emitter 트리거": "Fire condition (creation / expiration / timeline) + which values to copy → triggers a Sub Emitter",
  "발동원 파티클/이미터가 가진 값 중 체크된 것만 Sub Emitter 쪽 변수(v.seed 등)로 미리 대입해서 넘겨줍니다(pre_effect_expression). trigger 입력에 Emitter나 Sub Emitter를 연결하고, fire 출력을 발동시킬 Sub Emitter의 trigger 입력에 연결하세요. Sub Emitter의 fire를 또 다른 Event의 trigger에 연결해 계속 체이닝할 수 있습니다(Sub Emitter → Event → Sub Emitter …).": "Only the checked values from the source particle/emitter are passed to the Sub Emitter's variables (v.seed and so on) before it starts (pre_effect_expression). Connect an Emitter or Sub Emitter to the trigger input, and connect the fire output to the trigger input of the Sub Emitter you want to fire. You can keep chaining by connecting a Sub Emitter to another Event's trigger (Sub Emitter → Event → Sub Emitter …).",
  "발동원의 bone에 부착 (emitter_bound)": "Attach to the source's bone (emitter_bound)",
  "발산 없는(비압축) 벡터장 노이즈 — fx/fy/fz 힘 출력. 연기·불·소용돌이 같은 유체형 터뷸런스 움직임에 사용. flow 옵션으로 패턴이 시간에 따라 흐르게 가능. 미리보기는 흐름 화살표(벡터장)로 표시": "Divergence-free (incompressible) noise vector field — outputs a force fx/fy/fz. Use it for fluid-like swirling motion such as smoke, fire and eddies. The flow option makes the pattern drift over time. The preview shows the field as arrows",
  "밝기 그래디언트": "Brightness gradient",
  "밝기(Luminance)": "Brightness (luminance)",
  "방향": "direction",
  "방향 {0}": "direction {0}",
  "방향 벡터 (dirX, dirY, dirZ)": "Direction (dirX, dirY, dirZ)",
  "방향 추출 방식": "Direction mode",
  "범위 제한": "Range limit",
  "베이킹 해상도 (그리드 한 변 셀 수 · 직접 입력)": "Bake resolution (cells per side · type a number)",
  "벽 보정 수식 a+(b-c)*K 가 {0}개 있습니다. 이 수식은 벽에 닿은 파티클을 튀게 만들 수 있어요. 안정적인 a+(b-c)/dt 로 바꿀까요? (취소하면 그대로 둡니다)": "There are {0} wall correction formulas of the form a+(b-c)*K. This form can make particles that touch a wall jump. Change them to the stable a+(b-c)/dt? (Cancel keeps them as they are.)",
  "벽의 개수": "Number of walls",
  "변수 a,b,c,d,t = 입력 소켓(t는 미연결시 위 시간축 기준 자동값) · dt = Accumulate 적분 한 스텝의 길이(초, 밖에서는 1/60 — 벽 보정은 a+(b-c)/dt 권장) · pa = v.particle_age · ea = v.emitter_age · 함수: sin cos tan abs sqrt pow floor trunc lerp min max clamp random": "Variables a, b, c, d, t = input sockets (t is automatic from the time axis above if not connected) · dt = length of one Accumulate integration step in seconds (1/60 outside one — for wall correction use a+(b−c)/dt) · pa = v.particle_age · ea = v.emitter_age · functions: sin cos tan abs sqrt pow floor trunc lerp min max clamp random",
  "복사": "Copy",
  "복사됨 ✓": "Copied ✓",
  "복제": "Duplicate",
  "부력 방향 (dirX, dirY, dirZ)": "Buoyancy direction (dirX, dirY, dirZ)",
  "분산": "split",
  "붙여넣기": "Paste",
  "붙여넣을 노드가 없습니다": "Nothing to paste",
  "비우면 ORE VFX": "Empty = ORE VFX",
  "비우면 자동:": "Empty = automatic:",
  "비우면 자동: {0}": "Empty = automatic: {0}",
  "비우면 자동: {1}": "Leave empty for automatic: {1}",
  "비우면 파일 이름": "Empty = file name",
  "빈 그래프": "Empty graph",
  "빈 수식": "Empty formula",
  "빌드 실패:": "Build failed:",
  "빌드 실패: {0}": "Build failed: {0}",
  "빌드 실패: {0} —": "Build failed: {0} —",
  "빌드 실패: {0} — {1}": "Build failed: {0} — {1}",
  "사용 가능 변수: j,n,h,seed / 함수: sin cos tan abs sqrt pow floor lerp min max clamp random 등. 반지름(r1/r2) 같은 값은 전용 슬롯이 없습니다 — 수식 안에 숫자로 직접 쓰거나, 위 프리셋을 불러와 이미 채워진 숫자를 그대로 고쳐 쓰세요.": "Variables: j, n, h, seed / functions: sin cos tan abs sqrt pow floor lerp min max clamp random and more. Values like a radius (r1/r2) have no separate field — write them as numbers in the formula, or load a preset above and edit the numbers it fills in.",
  "사인 웨이브 (Sine Wave)": "Sine Wave",
  "삭제": "Delete",
  "삼항 개수 상한 (이 이상이면 자동으로 근사로 전환)": "Max ternaries (switches to the approximation automatically above this)",
  "상수 노드: 입력 없이 value를 그대로 out으로 내보냅니다. 같은 값을 여러 노드에 연결해 한 곳에서 바꾸고 싶을 때 쓰세요. value에": "Constant node: outputs value as out, with no inputs. Use it when several nodes should share one value you change in a single place. Writing ",
  "상수 노드의 v.{0} 은(는) 예약된 이름이라 쓸 수 없습니다. 다른 이름을 쓰세요.": "v.{0} in a Constant node is a reserved name and can't be used. Choose another name.",
  "상수 노드의 v.{0} 이(가) 에디터 내부 변수 이름과 겹칩니다. 다른 이름(예: v.my_{1})을 쓰세요.": "v.{0} in a Constant node clashes with an internal editor variable. Use another name (e.g. v.my_{1}).",
  "상수값 하나를 그대로 출력 — Accumulate의 in(초당 증가량)·init(초기값), Formula 입력 등에 연결해 쓰는 값 노드": "Outputs a single fixed value — a value node for Accumulate's in (increase per second) or init (start value), Formula inputs and so on",
  "상태 없는(stateless) 누적: out = init + ∫₀ᵀ in dt. v.* 변수에 값을 저장하지 않고 매 프레임 id·시간에서 처음부터 다시 계산하므로 파티클끼리 변수가 섞이지 않습니다. in/reset 미연결이면 rate×T 닫힌 형태(정확). 연결하면 in 상류를 N개 시각(중점)마다 통째로 다시 컴파일해 합산하므로 식 길이가 N배가 되고 결과는 근사입니다. reset=1이면 그 샘플 시점에서 누적이 0으로 돌아가고, clamp는 스텝마다 적용됩니다. 자기 출력을 읽는 피드백은 직전 샘플 값을 읽습니다. 여러 Accumulate가 서로의 in/reset 상류를 되먹임하는 구조(예: 위치 x/y/z가 벽 노드를 거쳐 서로 참조)는 하나의 연립 시스템으로 묶어 같은 N개 시각에서 동시에 적분하므로 식 길이는 N배로 유지됩니다(그룹 내 timeSource는 같아야 합니다. samples는 노드마다 달라도 되며 가장 큰 값이 기본 스텝이 되고, 작은 노드는 여러 스텝을 묶어 한 번씩 갱신합니다 — 단, 본문 반복 수는 가장 큰 값이라 식 길이는 줄지 않고, a+(b-c)/dt 같은 dt 보정은 samples가 다른 노드에선 구간 길이만큼 배로 적용되니 같은 값으로 두세요). 미리보기도 같은 방식으로 계산합니다.": "Stateless accumulation: out = init + ∫₀ᵀ in dt. Nothing is stored in v.* variables — the value is recomputed from scratch every frame from the id and time, so particles never mix up each other's variables. With in/reset not connected it uses the exact closed form rate×T. When connected, everything upstream of in is recompiled at N time points (midpoints) and summed, so the formula becomes N times longer and the result is an approximation. reset = 1 sets the total back to 0 at that sample, and clamp is applied at every step. Feedback that reads its own output reads the previous sample. When several Accumulate nodes feed back into each other's in/reset (for example x/y/z positions that reference each other through a Wall node), they are grouped into one system and integrated together at the same N time points, so the formula stays N times longer (all nodes in a group must use the same timeSource. samples may differ per node: the largest is the base step and smaller nodes update once every few steps — but the loop still runs the largest count, so the formula is not shorter, and a dt correction like a+(b−c)/dt is multiplied by the interval length on nodes with different samples, so keep them equal). The preview is computed the same way.",
  "새 그래프 탭": "New graph tab",
  "색상 {0}": "color {0}",
  "색상(tint r/g/b/a) 복사": "Copy color (tint r/g/b/a)",
  "생성 모드": "Spawn mode",
  "생성 시 (creation_event) · 발동원이 생성되는 순간": "On creation (creation_event) · the moment the source is created",
  "생존": "alive",
  "서로 피드백으로 묶인 Accumulate({0})는 적분 시간 T(timeSource)가 모두 같아야 합니다. particle_age 또는 emitter_age 한쪽으로 통일해 주세요.": "Accumulate nodes tied together by feedback ({0}) must all use the same integration time T (timeSource). Set them all to particle_age or all to emitter_age.",
  "선택 모드 (노드 탭 = 선택/해제, 빈 곳 드래그 = 범위 선택, 두 손가락 = 이동·확대)": "Select mode (tap a node = select/deselect, drag on empty space = box select, two fingers = pan/zoom)",
  "선택 모드 종료": "Exit select mode",
  "선택 모드: 노드를 탭하거나 빈 곳을 드래그하세요 · 두 손가락으로 이동/확대": "Select mode: tap nodes or drag on empty space · two fingers to pan/zoom",
  "선택 없음": "Nothing selected",
  "선택된 노드가 없습니다": "No nodes selected",
  "설명": "Description",
  "설명 보기/닫기": "Show/hide description",
  "소리 (sound_effect · 비우면 없음)": "Sound (sound_effect · empty = none)",
  "소멸": "expired",
  "소멸 시 (expiration_event) · 발동원 수명이 끝나는 순간": "On expiration (expiration_event) · the moment the source's lifetime ends",
  "소용돌이 힘 미리보기 (X-Y 단면)": "Vortex force preview (X-Y slice)",
  "소켓 → Bedrock 필드 매핑": "Maps sockets to Bedrock fields",
  "소켓을 드래그해 다른 노드에 연결합니다.": "Drag from a socket to another node to connect them.",
  "수명(초) · kill 시점": "Lifetime (s) · when the effect is killed",
  "수식": "Formula",
  "수식이 예기치 않게 종료됨": "The formula ended unexpectedly",
  "수평 원판 위에 균일 분포": "Even spread over a flat disc",
  "수평 파형 배치": "Particles laid out along a horizontal wave",
  "순환 오프셋 누적 (emitter_age 비례, 리셋 없음)": "Add a moving offset (follows emitter_age, never resets)",
  "스텝 분할": "Step spacing",
  "시간에 따라 세기 맥동 (pulse)": "Pulse the strength over time (pulse)",
  "시간에 따라 세기 변조 (gust)": "Vary the strength over time (gust)",
  "시간에 따라 패턴이 흐르게 (flow)": "Make the pattern flow over time (flow)",
  "시간축": "Time axis",
  "시뮬레이션 불가:": "Can't simulate:",
  "시뮬레이션 불가: {0}": "Can't simulate: {0}",
  "시작각 오프셋(°) · j=0 파티클 위치 회전": "Start angle offset (°) · rotates where particle j=0 sits",
  "식는 곡선 지수(1=선형, 클수록 초반에 급격히 식음)": "Cooling curve exponent (1 = linear, higher = cools fast at first)",
  "식는 데 걸리는 시간(초) · 이 시간 이후 온도=0": "Cooling time (s) · temperature = 0 after this",
  "식별자 \"{0}\"를 두 이미터({1}, {2})가 같이 쓰고 있습니다. 서로 다르게 바꿔주세요.": "The identifier \"{0}\" is used by two emitters ({1}, {2}). Give them different identifiers.",
  "식별자는 /particle 명령어나 스크립트에서 부르는 이름입니다. 콜론이 없으면 \"ore:\"가 붙고, 소문자·숫자·_·. 만 쓸 수 있습니다. 명칭은 노드 제목과 미리보기 목록에만 보이고 JSON에는 들어가지 않습니다(베드락 파티클 형식에 표시 이름 칸이 없음).": "The identifier is the name you use with the /particle command or in scripts. Without a colon, \"ore:\" is added; only lowercase letters, digits, _ and . are allowed. The display name only appears on the node title and in the preview list — it is not written to the JSON (the Bedrock particle format has no display-name field).",
  "실무 표준 파이프라인: 이진화 → 외곽선 추적(Moore-Neighbor border following, OpenCV findContours와 같은 계열, 끊어진 덩어리는 각각 별도 추적) → 등간격 재샘플링 →": "Standard pipeline: threshold → outline tracing (Moore-neighbor border following, the same family as OpenCV findContours; separate shapes are traced separately) → evenly spaced resampling →",
  "아이콘 이미지 선택": "Choose an icon image",
  "아이콘 지우기": "Remove icon",
  "아틀라스 · 현재 프레임": "Atlas · current frame",
  "안전": "Safe",
  "알 수 없는 facing_camera_mode:": "Unknown facing_camera_mode:",
  "알 수 없는 facing_camera_mode: {0}": "Unknown facing_camera_mode: {0}",
  "알 수 없는 math.": "Unknown math.",
  "알 수 없는 math.{0}": "Unknown math.{0}",
  "알 수 없는 함수: {0}": "Unknown function: {0}",
  "알파 채널": "Alpha channel",
  "앞": "Fwd",
  "엔티티(로케이터)에 붙어 있을 때만 효과가 있습니다. position을 켜면 파티클이 엔티티를 따라다니고, 끄면 월드에 남습니다. rotation만 켜고 position을 끄는 조합은 문서상 허용되지 않아 rotation을 켜면 position도 함께 켜집니다.": "Only has an effect when the particle is attached to an entity (locator). With position on, particles follow the entity; with it off, they stay in the world. Turning on rotation without position is not allowed by the format, so turning on rotation also turns on position.",
  "여러 색상 정지점을 t(0~1)로 보간 → r/g/b 출력. 실제 그라디언트 바를 눈으로 보며 편집(Unity/Houdini의 Gradient 노드와 동일한 개념)": "Blends several color stops along t (0–1) → outputs r/g/b. Edit it on a real gradient bar (same idea as the Gradient node in Unity and Houdini)",
  "여러 탭에서 같은 식별자를 쓰고 있습니다:": "Several tabs use the same identifier:",
  "여러 탭에서 같은 식별자를 쓰고 있습니다: {0}": "Several tabs use the same identifier: {0}",
  "여러 탭에서 같은 식별자를 쓰고 있습니다: {0} 탭 이름이나 이미터 식별자를 서로 다르게 바꿔주세요.": "Several tabs use the same identifier: {0} Give the tabs or emitter identifiers different names.",
  "연결한 값은 게임 실행 중에 계산됩니다. 원점 쪽 면 방식에서 \"어느 면에 부딪힐지\"는 칸에 적힌 숫자로 정해지고, 면의 위치만 연결한 값을 따릅니다. 3D 미리보기의 벽 상자는 칸에 적힌 숫자로 그려집니다.": "Connected values are computed while the game runs. In face-toward-origin mode, \"which face it hits\" is decided by the numbers typed in the fields; only the face positions follow the connected values. The wall boxes in the 3D preview are drawn from the typed numbers.",
  "연산 노드 {0}→{1} ({2}% 감소) · 글자수 {3}→{4} · 평가시간 {5}→{6}ms · 최대오차 {7} · 식검증 {8}/{9}{10}": "Operations {0}→{1} ({2}% fewer) · characters {3}→{4} · eval time {5}→{6}ms · max error {7} · formulas verified {8}/{9}{10}",
  "열려 있는 모든 탭의 파티클을 이 팩 하나에 넣기": "Put the particles from all open tabs into this one pack",
  "열린 탭 전부를 .txt 파일로 저장": "Save all open tabs to a .txt file",
  "열린 탭을 모두 닫고 저장 파일의 탭 {0}개를 불러올까요?": "Close all open tabs and load the {0} tabs from the saved file?",
  "영역 바람 미리보기 (X-Y 단면)": "Wind zone preview (X-Y slice)",
  "영역 형태": "Zone shape",
  "영역(박스/구) 안에서만 부는 국소 바람 — fx/fy/fz 출력. Unity \"Wind Zone\", Niagara의 볼륨 제한 Wind Force와 동일. 특정 구역에서만 바람이 부는 연출(창틈 바람, 국소 돌풍)에 사용. gust 옵션으로 세기 변조, turbulence와 함께 쓰면 방향·세기 모두 흔들리는 자연스러운 돌풍": "Local wind that blows only inside a box or sphere — outputs fx/fy/fz. Same as Unity \"Wind Zone\" and Niagara's volume-limited Wind Force. Use it for wind in one area only (a draft through a window, a local gust). The gust option varies the strength; together with turbulence both direction and strength waver naturally",
  "예: head": "e.g. head",
  "예: random.pop": "e.g. random.pop",
  "예: v.hit=1;": "e.g. v.hit=1;",
  "예: 불꽃 폭발": "e.g. Fire burst",
  "예상치 못한 토큰 '{0}'": "Unexpected token '{0}'",
  "예상치 못한 토큰: '{0}'": "Unexpected token: '{0}'",
  "예제와 동일 · 황금각 나선 방추(포물선 반지름 보간)": "Same as the example · golden-angle spiral spindle (parabolic radius blend)",
  "오프셋 증분 X (emitter_age 1초당)": "Offset step X (per second of emitter_age)",
  "오프셋 증분 Y (emitter_age 1초당)": "Offset step Y (per second of emitter_age)",
  "오프셋 증분 Z (emitter_age 1초당)": "Offset step Z (per second of emitter_age)",
  "온도차(T-T_ambient) 기반 부력 — fx/fy/fz 출력. Houdini pop buoyancy와 동일 개념. 뜨거운 연기/불이 위로 뜨는 움직임. temperature 미연결시 emitter_age(이미터 전역 경과시간) 또는 particle_age(개별 파티클 생존시간, v5부터 유효) 중 선택해 자동 식음": "Buoyancy from a temperature difference (T − T_ambient) — outputs fx/fy/fz. Same idea as Houdini POP Buoyancy. Makes hot smoke or fire rise. If temperature is not connected it cools down automatically over emitter_age (time since the emitter started) or particle_age (each particle's own age)",
  "완료": "Done",
  "외곽선을 찾지 못함": "No outline found",
  "우 ▶": "Right ▶",
  "우클릭": "right-click",
  "우클릭 노드 추가 · 드래그 이동 · 휠 줌": "Right-click to add a node · drag to move · scroll to zoom",
  "우클릭 노드 추가 · 빈 곳 드래그 선택 · 가운데/우클릭 드래그 이동 · 휠 줌 · Ctrl+C/V/D/Z": "Right-click to add a node · drag on empty space to select · middle/right-drag to pan · scroll to zoom · Ctrl+C/V/D/Z",
  "우클릭 유지 + WASD 이동 · Space 위 · Shift 아래": "Hold right-click + WASD to move · Space up · Shift down",
  "원기둥 (Cylinder)": "Cylinder",
  "원뿔 (Cone)": "Cone",
  "원점 쪽 면": "Face toward the origin",
  "원점 쪽 면 (한 면만 · 수식 궤적용)": "Face toward the origin (one face only · for formula trajectories)",
  "원점 쪽 면: 이미터 원점을 향한 한 면만 막습니다. Shape·Noise처럼 수식으로 계산한 궤적이 벽을 깊이 지나가도 떨리지 않지만, 옆면이나 반대쪽에서 들어온 입자도 그 한 면으로 밀어냅니다. 가장 가까운 면: 박스 안에 들어온 입자를 가장 얕게 들어간 면 밖으로 밀어냅니다. 벽 출력이 a+(b-c)/dt를 거쳐 Accumulate로 되돌아가는(위치가 매 스텝 보정되는) 그래프에 맞습니다. auto는 이 피드백 연결을 감지해 자동으로 고릅니다. 가장 가까운 면 방식에서는 속도 정보가 없어 마찰력이 적용되지 않습니다.": "Face toward the origin: blocks only the one face that points toward the emitter origin. A formula trajectory (Shape, Noise…) that passes deep through the wall won't jitter, but particles that come in from the side or the far side are also pushed out through that one face. Nearest face: pushes a particle inside the box out through the face it entered least deeply. Suited to graphs where the wall output goes through a+(b−c)/dt back into an Accumulate (the position is corrected every step). auto detects this feedback connection and picks for you. In nearest-face mode there is no velocity information, so friction is not applied.",
  "원판 (Disc)": "Disc",
  "월드 배치 옵션": "Placement in the world",
  "위로 갈수록 좁아지는 나선(포물선 보간 가능)": "Spiral that narrows toward the top (parabolic blend available)",
  "위치 {0}": "position {0}",
  "위치(offset) 복사": "Copy position (offset)",
  "위치(x,y,z)를 받아 벽에 부딪힌 뒤의 위치(x,y,z)를 출력합니다. 벽은 min/max로 정한 축 정렬 박스이며, 입력 위치가 박스 안으로 들어오면 가장 가까운 면 바깥으로 밀려납니다. 반동은 되튕기는 비율(0=달라붙음, 1=슬라임 블록처럼 완전 반사), 마찰력은 벽 접촉 중 면과 평행한 이동량을 깊이에 비례해 줄이는 정도(이미터 원점 기준)입니다. 위치를 수식으로 직접 계산하는 방식이라 속도 기반 물리 충돌의 근사치입니다. 벽이 여러 개면 wall_1부터 차례로 적용됩니다.": "Takes a position (x, y, z) and outputs the position after hitting the walls (x, y, z). A wall is an axis-aligned box defined by min/max; if the input position goes inside the box it is pushed out past the nearest face. Bounce is how much it rebounds (0 = sticks, 1 = full bounce like a slime block); friction is how much sliding along the face is reduced while touching, in proportion to depth (measured from the emitter origin). Positions are computed by formula, so this approximates velocity-based physics collisions. With several walls they are applied in order starting from wall_1.",
  "을 쓰면 마인크래프트 변수를 읽는 노드가 됩니다(게임 쪽에서 값 조절).": " in value turns it into a node that reads a Minecraft variable (so the game can control the value).",
  "을(를) 그대로 읽습니다. 게임에서 이 변수에 값을 넣으면(예: 스크립트의 MolangVariableMap으로 \"variable.{1}\" 설정) 이펙트를 바깥에서 조절할 수 있습니다. 값을 넣지 않으면 0입니다. 에디터 미리보기에서는 아래 \"미리보기 값\"을 씁니다.": " directly. If the game sets this variable (for example \"variable.{1}\" through a script's MolangVariableMap), the effect can be controlled from outside. If nothing sets it, it is 0. The editor preview uses the \"Preview value\" below.",
  "이 그래프로 전환": "Switch to this graph",
  "이 노드에는 입력으로 바꿀 수 있는 숫자 칸이 없습니다. (개수·종류·옥타브처럼 식의 구조를 정하는 값은 연결할 수 없습니다)": "This node has no number fields that can take an input. (Values that decide the shape of the formula — counts, types, octaves — cannot be connected.)",
  "이 시간축은 v.emitter_age(이미터가 켜진 뒤 전역으로 계속 흐르는 시간) 기준입니다 — 개별 파티클 나이와 무관합니다. \"이미터 전체가 켜진 뒤 서서히 옅어지는\" 연출에 적합합니다(예: 폭발 직후 잔여 연기가 걷힘).": "This time axis is v.emitter_age (global time since the emitter turned on), independent of each particle's age. Good for \"the whole effect slowly fades after it starts\" (e.g. leftover smoke clearing after an explosion).",
  "이 시간축은 v.particle_age(개별 파티클이 태어난 뒤 흐르는 생존시간) 기준입니다 — v5부터 실제 생존시간을 의미하므로 유효합니다. 파티클마다 각자 태어난 시점부터 옅어지는 연출에 적합합니다(예: 개별 불씨/연기 입자가 각자 페이드아웃).": "This time axis is v.particle_age (time since each particle was born) — valid since v5, where it means each particle's real age. Good for fading each particle from its own birth (e.g. each ember or smoke puff fades out on its own).",
  "이 연결을 삭제할까요?": "Delete this connection?",
  "이 태어난 뒤 식어가는 시간축입니다(v5부터 particle_age가 실제 생존시간을 의미하므로 유효). 파티클마다 각자 태어난 시점 기준으로 뜨거웠다가 식습니다.": " cools down starting from its own birth (valid since v5, where particle_age means each particle's real age). Every particle starts hot and cools from the moment it was born.",
  "이미지 y축(아래+) → 월드 z축(위+) 반전": "Flip image y (down = +) to world z (up = +)",
  "이미지 업로드": "Upload image",
  "이미지 업로드 → 밝기/알파/RGB 채널 기준 외곽선 추출 → Elliptic Fourier Descriptors로 근사 수식 생성. x/y/z 출력 — 로고·글자·실루엣 모양으로 파티클을 배치": "Upload an image → trace its outline (by brightness, alpha or an RGB channel) → turn it into a formula with Elliptic Fourier Descriptors. Outputs x/y/z — lays particles out in the shape of a logo, text or silhouette",
  "이미지를 그리드로 \"구워서\"(bake) 각 셀에 힘의 방향을 저장하는 커스텀 벡터장.": "A custom vector field that \"bakes\" an image onto a grid, storing a force direction in each cell.",
  "이미지를 업로드하세요": "Upload an image",
  "이미지를 업로드해 그리드로 구운 커스텀 벡터장 — fx/fy 힘 출력. 밝기 그래디언트/마스크 경계/RGB 플로우맵 3가지 방식 지원. 로고·문양·커스텀 형태로 파티클을 흐르게 할 때 사용": "A custom vector field baked onto a grid from an uploaded image — outputs a force fx/fy. Three modes: brightness gradient, mask edge, or RGB flow map. Use it to make particles flow along a logo, pattern or custom shape",
  "이미터 반복(looping) — kill 없이 계속 방출": "Loop the emitter — keep emitting without being killed",
  "이미터 전체": "The whole emitter ",
  "이벤트 연쇄가 너무 깊어": "Event chain is too deep;",
  "이벤트 연쇄가 너무 깊어 {0}": "Event chain is too deep; {0}",
  "이벤트 연쇄가 너무 깊어 {0}단계에서 멈춤": "Event chain is too deep; stopped at step {0}",
  "이중 나선 (Double Helix)": "Double Helix",
  "인력/척력 미리보기 (X-Y 단면)": "Attract/repel preview (X-Y slice)",
  "인스턴스가 {0}개를 넘어 나머지는 생략": "More than {0} instances; the rest were skipped",
  "인식 불가 문자: '{0}'": "Unrecognized character: '{0}'",
  "일정한 방향으로 미는 힘(중력/바람) — fx/fy/fz 출력. Niagara \"Gravity Force\"/\"Wind Force\"와 동일. 낙하·바람에 날리는 효과의 기본 힘. gust 옵션으로 세기가 시간에 따라 변하는 돌풍 표현 가능": "A constant push in one direction (gravity or wind) — outputs fx/fy/fz. Same as Niagara \"Gravity Force\" / \"Wind Force\". The basic force for falling or wind-blown effects. The gust option varies the strength over time",
  "일치하는 노드가 없습니다": "No matching nodes",
  "입력 범위 (inMin ~ inMax)": "Input range (inMin – inMax)",
  "입력 소켓 값으로 미리보기 중": "Previewing with the input socket values",
  "입력값을 [inMin,inMax] 구간에서 [outMin,outMax] 구간으로 재매핑(clamp 옵션) — Unity/Houdini의 Remap/Fit 노드와 동일. 노이즈나 벡터장 세기를 원하는 범위로 손쉽게 조정": "Maps a value from the range [inMin, inMax] to [outMin, outMax] (optional clamp) — same as the Remap/Fit node in Unity and Houdini. An easy way to bring noise or field strength into the range you want",
  "입력값을 기준값과 비교해 0/1로 이진화(softness로 경계 부드럽게) — Shader Graph의 \"Step\"과 동일. Noise 3D 출력을 여기 연결하고 threshold를 Curve로 움직이면 노이즈 패턴을 따라 사라지는 dissolve 효과. 출력을 tint.a에 연결": "Compares a value with a threshold and outputs 0 or 1 (softness smooths the edge) — same as \"Step\" in Shader Graph. Feed it Noise 3D and animate the threshold with a Curve for a dissolve effect that follows the noise pattern. Connect the output to tint.a",
  "입력이 연결돼 있어 연결된 노드의 값을 씁니다": "An input is connected, so the value comes from the connected node",
  "입방 격자 분포(근사)": "Points on a cubic grid (approximate)",
  "자동 (direction 블록 생략)": "Automatic (no direction block)",
  "자유 수식 → Molang 자동변환. t(시간) 입력 소켓 포함 — Vortex/Attractor 등 다른 노드의 strength·radius에 연결해 시간 변조 가능": "Write any formula; it is converted to Molang for you. Has a t (time) input — connect it to another node's strength or radius (Vortex, Attractor…) to animate it over time",
  "재샘플링 점 개수 K (덩어리마다 동일 적용)": "Resample points K (same for every shape)",
  "재생 구간 (startFrame · frameCount)": "Playback range (startFrame · frameCount)",
  "재생 방식": "Playback mode",
  "저주파 근사(sin/cos · 항상 짧고 안전)": "Low-frequency approximation (sin/cos · always short and safe)",
  "적분 시간 T": "Integration time T",
  "전경 픽셀을 찾지 못했습니다 — threshold나 반전 옵션을 조정해보세요.": "No foreground pixels were found — try adjusting threshold or the invert option.",
  "전경/배경 반전": "Swap foreground and background",
  "전체": "All",
  "점유중": "linked",
  "정의되지 않은 변수 사용: v.": "Undefined variable used: v.",
  "정의되지 않은 변수 사용: v.{0}": "Undefined variable used: v.{0}",
  "정확한 룩업(삼항 체인 · 정확하지만 길어짐": "Exact lookup (chain of ternaries · exact but long",
  "제한 없음": "No limit",
  "줌 {1}%": "Zoom {1}%",
  "중심 좌표 (cx, cy, cz)": "Center (cx, cy, cz)",
  "지금 보고 있는 탭(그래프)만 .txt 파일로 저장 — 불러오면 새 탭으로 추가됩니다": "Save only the current tab (graph) to a .txt file — loading it adds it as a new tab",
  "지속 생성: 아래 count는 \"도형 슬롯 수\"(shape가 순환하는 개수, ≤1000)가 되고, 파티클은 생성 순서 j를 count로 나눈 나머지를 id로 받아 도형을 순환합니다. 방출은 아래 수명(초) 동안 이어지고(반복 체크 시 무한), 개별 파티클은 위 수명 뒤 소멸합니다.": "Steady mode: count below becomes the number of \"shape slots\" (how many positions the shape cycles through, ≤1000). Each particle takes its spawn order j modulo count as its id and cycles through the shape. Emission lasts for the lifetime (s) below (forever if looping is on); each particle disappears after the particle lifetime above.",
  "진행 방식": "Playback",
  "진행 시간축은 v.emitter_age 기준(리셋 없이 전역으로 계속 흐르는 실제 경과 시간) — 프레임 = floor(emitter_age × fps). 개별 파티클 나이와 무관하게 이펙트 전체가 같은 프레임을 공유한다.": "Progress follows v.emitter_age (real time since the emitter turned on, never reset) — frame = floor(emitter_age × fps). The whole effect shares the same frame regardless of each particle's age.",
  "진행 시간축은 v.particle_age 기준(개별 파티클이 태어난 뒤 흐르는 생존시간) — 프레임 = floor(particle_age × fps). v5부터 particle_age가 실제 생존시간을 의미하므로 유효하다. 파티클마다 각자 태어난 시점부터 프레임이 재생된다.": "Progress follows v.particle_age (time since each particle was born) — frame = floor(particle_age × fps). Valid since v5, where particle_age means each particle's real age. Each particle plays the frames from its own birth.",
  "진행사항 백업 파일 형식이 아닙니다.": "This is not a progress backup file.",
  "차 하모닉)": "harmonics)",
  "체크 시 이 이벤트가 만드는 Sub Emitter는 발동원(Emitter/Sub Emitter)이 붙어있는 본/로케이터에 그대로 붙어서 생성됩니다(type: emitter_bound). 해제하면 발동 위치의 월드 좌표에 독립적으로 생성됩니다(type: emitter).": "When checked, the Sub Emitter created by this event is attached to the same bone/locator as the source (Emitter/Sub Emitter) (type: emitter_bound). When unchecked, it is created independently at the world position where the event fired (type: emitter).",
  "초": "s",
  "초기화": "Clear",
  "최대 덩어리(끊긴 도형) 개수 · 둘레비례 자동 분배": "Max separate shapes · particles split by perimeter",
  "최상위 Emitter 노드는 하나만 사용할 수 있습니다 (v1.0 제한).": "Only one top-level Emitter node can be used (v1.0 limit).",
  "최적화 건너뜀:": "Optimization skipped:",
  "최적화 건너뜀: {0}": "Optimization skipped: {0}",
  "최적화 건너뜀: 식이 매우 큽니다({0}KB{1}). 기기가 멈추지 않도록 원본을 그대로 씁니다 — 무거우면 Accumulate samples를 줄여 보세요(식이 길어도 프리뷰는 정상 동작합니다).": "Optimization skipped: the formula is very large ({0}KB{1}). The original is kept so your device doesn't freeze — if it feels heavy, try lowering Accumulate samples (the preview still works with long formulas).",
  "최적화 결과가 원본과 달라(오차": "The optimized result differed from the original (error",
  "최적화 결과가 원본과 달라(오차 {0}": "The optimized result differed from the original (error {0}",
  "최적화 결과가 원본과 달라(오차 {0}) 원본을 유지했습니다.": "The optimized result differed from the original (error {0}), so the original was kept.",
  "추적 해상도(그리드 한 변 · 정밀도)": "Trace resolution (grid size · precision)",
  "추적된 외곽선 · 근사 결과": "Traced outline · approximation",
  "추출 →": "Export →",
  "추출 결과가 비어 있습니다. Emitter → Shape/처리노드 → Output 연결을 확인하세요.": "The export result is empty. Check the Emitter → Shape/processing nodes → Output connections.",
  "추출 기준(모드)": "Trace mode",
  "추출 중 예외가 발생했습니다: {0}": "An exception occurred during export: {0}",
  "축 중심 회전 소용돌이 흐름(점성 결합 + 구심 가속) — fx/fy/fz 출력. Unity VFX Graph \"Vortex\", Unreal Niagara \"Vortex Velocity Force\"와 동일 개념. 태풍·회오리·빨려들어가는 소용돌이 연출. pulse 옵션으로 세기가 주기적으로 맥동하게 가능": "Swirling flow around an axis (viscous coupling + centripetal pull) — outputs fx/fy/fz. Same idea as Unity VFX Graph \"Vortex\" and Unreal Niagara \"Vortex Velocity Force\". For typhoons, tornadoes and particles being sucked into a whirl. The pulse option makes the strength throb periodically",
  "출력 n의 연결 위치를 컴파일러가 자동 역추적함. offset(offx/y/z 또는 다른 노이즈 입력)에만 연결 → 1회 계산. size/tint(r/g/b/a)에 연결 → max_lifetime에 저장된 id로 좌표를 복원해 파티클마다 매 프레임 통째로 재계산(양자화·슬롯 제한 없음). 양쪽 다 연결되면 두 경로에서 각각 독립 재계산.": "The compiler works out where output n is connected. Connected only to offset (offx/y/z or another noise input) → computed once. Connected to size/tint (r/g/b/a) → recomputed in full for every particle each frame, using the id stored in max_lifetime to rebuild its position (no quantization, no slot limit). Connected to both → each path is computed independently.",
  "출력 x/z는 이미지 외곽선을, y는 위 수식(기본 평면=0)을 따릅니다. j(파티클 인덱스)가 외곽선을 한 바퀴 도는 매개변수 t=j/n*360°에 매핑되어 n개 파티클이 윤곽선을 고르게 나눠 맡습니다 — 이 노드는 일반 Shape 노드와 동일한 x/y/z 출력을 가지므로 Output이나 Noise 3D 등 다른 노드에 그대로 연결해서 씁니다.": "The x/z outputs follow the image outline; y follows the formula above (default flat = 0). The particle index j maps to t = j/n×360°, one lap around the outline, so n particles share the outline evenly. This node has the same x/y/z outputs as a regular Shape node, so connect it to Output, Noise 3D and other nodes the same way.",
  "출력 범위 (outMin ~ outMax)": "Output range (outMin – outMax)",
  "출력 범위 밖으로 나가지 않게 clamp": "Clamp so it never leaves the output range",
  "충돌 면 결정 방식": "How the collision face is chosen",
  "취소": "Cancel",
  "카메라 위치 초기화": "Reset camera position",
  "칸 하나 크기 (texel w × h)": "Cell size (texel w × h)",
  "큐브 격자 (Cube Grid)": "Cube Grid",
  "크기 {0}": "size {0}",
  "클릭하면 그래프 중앙에 추가되고, 그래프에서": "Click to add it to the middle of the graph, or ",
  "탭 이름 (= 내보내기 파일 이름 · 기본 식별자 ore:이름)": "Tab name (= export file name · default identifier ore:name)",
  "탭 이름이나 이미터 식별자를 서로 다르게 바꿔주세요.": "Give the tabs or emitter identifiers different names.",
  "텍스처 경로": "Texture path",
  "텍스처 경로가 textures/ 로 시작하지 않습니다:": "Texture path doesn't start with textures/:",
  "텍스처 경로가 textures/ 로 시작하지 않습니다: {0}": "Texture path doesn't start with textures/: {0}",
  "텍스처 아틀라스(그리드)를 시간에 따라 순서 재생 — u/v/uv_size.w/uv_size.h 출력. Unity \"Texture Sheet Animation\"/Niagara \"Sub UV\"와 동일. Output의 uv 소켓에 바로 연결해 스프라이트 시트 애니메이션(폭발·불꽃·연기 프레임 재생)을 구현": "Plays a texture atlas (a grid of frames) in order over time — outputs u/v/uv_size.w/uv_size.h. Same as Unity \"Texture Sheet Animation\" and Niagara \"Sub UV\". Connect it straight to the Output uv sockets for sprite-sheet animation (explosions, sparks, smoke frames)",
  "텍스처 아틀라스(스프라이트 시트)를 그리드로 나눠 프레임을 순서대로 재생 — Unity Particle System의 \"Texture Sheet Animation\", Unreal Niagara의 \"Sub UV Animation\"과 동일한 개념. u/v/uv_size.w/uv_size.h 네 출력을 Output 노드의 uv.u/uv.v/uv_size.w/uv_size.h에 각각 연결하세요. 폭발·불꽃·연기처럼 미리 렌더링된 프레임 시퀀스를 재생할 때 사용합니다.": "Splits a texture atlas (sprite sheet) into a grid and plays the frames in order — same idea as \"Texture Sheet Animation\" in Unity's Particle System and \"Sub UV Animation\" in Unreal Niagara. Connect the four outputs u/v/uv_size.w/uv_size.h to the Output node's uv.u/uv.v/uv_size.w/uv_size.h. Use it to play pre-rendered frame sequences such as explosions, flames or smoke.",
  "텍스처 이미지 표시/숨김": "Show/hide texture images",
  "튕겨 오르는 거리의 한계. 비움/-1=자동(위·아래 벽은 중력용으로 착지, 옆 벽은 무제한), 0=항상 선형 반사, 양수=직접 지정(최고 높이≈0.37×값×반동)": "Limit for how far it bounces back. Empty/−1 = automatic (top and bottom walls land like gravity, side walls unlimited), 0 = always a straight reflection, positive = set it yourself (max height ≈ 0.37 × value × bounce)",
  "특정 시각 (timeline) · 발동원 수명 중 지정 시각": "At a set time (timeline) · at a given time during the source's lifetime",
  "파일을 읽는 중 오류가 발생했습니다.": "An error occurred while reading the file.",
  "파일을 읽을 수 없습니다 — 이 편집기에서 저장한 백업(.txt) 파일이 맞는지 확인해주세요.": "Can't read the file — make sure it is a backup (.txt) file saved from this editor.",
  "파티클 #{0}": "Particle #{0}",
  "파티클 JSON 추출": "Export particle JSON",
  "파티클 나이 지정 시각 (timeline)": "At a particle age (timeline)",
  "파티클 생성 시 (creation_event)": "When a particle is created (creation_event)",
  "파티클 소멸 시 (expiration_event)": "When a particle expires (expiration_event)",
  "파티클 수 (1000개 초과 시 분산 이미터로 자동 분할)": "Particle count (auto-split above 1000)",
  "파티클 수·수명·ID 인코딩": "Particle count, lifetime and ID encoding",
  "파티클 수가 1000개를 초과해 이미터가 자동으로 {0}개 파일(⇢ 표시)로 분할되었습니다. 원본을 소환하면 나머지 분산 파일들도 자동으로 함께 소환됩니다.": "There are more than 1000 particles, so the emitter was split automatically into {0} files (marked ⇢). Spawning the original also spawns the other split files automatically.",
  "파티클 수가 1000을 초과": "More than 1000 particles",
  "파티클 수명(0~1) 기준 곡선 → 크기/알파 등에 연결. 그래프를 손가락으로 직접 그려서(포인트 추가/드래그) 커브 모양을 편집": "A curve over the particle's life (0–1) → connect it to size, alpha and so on. Draw the curve directly on the graph (tap to add points, drag to move them)",
  "파티클 수명(초) · pl": "Particle lifetime (s) · pl",
  "파티클 식별자 (identifier · namespace:name)": "Particle identifier (identifier · namespace:name)",
  "파티클 텍스처 이미지": "Particle texture image",
  "파티클 하나하나의 생성/소멸/타임라인에서 발동 → Sub Emitter · 소리 · Molang (particle_lifetime_events)": "Fires on each particle's creation, expiration or timeline → Sub Emitter, sound or Molang (particle_lifetime_events)",
  "파티클 합계가 {0}개를 넘어 일부 인스턴스 생략": "More than {0} particles in total; some instances were skipped",
  "파티클을 탭하면 디버거 정보가 표시됩니다.": "Tap a particle to see its debug info.",
  "팩 이름": "Pack name",
  "평가 오류(id": "Evaluation error (id",
  "평가 오류(id {0}": "Evaluation error (id {0}",
  "평가 오류(id {0}):": "Evaluation error (id {0}):",
  "평가 오류(id {0}): {1}": "Evaluation error (id {0}): {1}",
  "프리셋 불러오기 (수식을 채워줌 · 그 후 자유 편집)": "Load a preset (fills in the formulas · edit freely afterwards)",
  "피보나치 구면 분포": "Fibonacci distribution on a sphere",
  "필수 컴포넌트 누락:": "Missing required component:",
  "필수 컴포넌트 누락: {0}": "Missing required component: {0}",
  "하면 그 위치에 바로 추가할 수 있어요.": " on the graph to add it right there.",
  "한 번 더 누르면 메뉴 (이름 바꾸기·복제·닫기)": "Tap again for the menu (rename · duplicate · close)",
  "한 점을 향한 인력(+)/척력(-) 힘 — fx/fy/fz 출력. Unity \"Sphere Attraction\", Niagara \"Point Attraction Force\"와 동일. 폭발 흡수·수집 이펙트·자석 연출. pulse 옵션으로 세기가 심장박동처럼 맥동하게 가능": "Pulls particles toward a point (+) or pushes them away (−) — outputs fx/fy/fz. Same as Unity \"Sphere Attraction\" and Niagara \"Point Attraction Force\". For implosions, collect effects and magnets. The pulse option makes the strength beat like a heart",
  "항력 계수 하나를 출력합니다(Bedrock linear_drag_coefficient 기준, Niagara \"Drag Force\"와 같은 개념). 참고: 이 에디터는 파티클을 엔진 물리가 아니라 수식으로 움직이므로 Output에 drag 소켓이 없습니다 — 값은 Formula 같은 다른 노드에 숫자로 연결해 쓰세요": "Outputs a drag coefficient (based on Bedrock's linear_drag_coefficient; same idea as Niagara \"Drag Force\"). Note: Output has no drag socket — this editor moves particles by formula, not by the engine's physics — so the value only works as a plain number you feed into other nodes (for example a Formula)",
  "해시 기반 의사난수 분포": "Pseudo-random spread based on a hash",
  "해제": "Deselect",
  "현재 그래프를 덮어쓰고 백업 파일을 불러올까요?": "Replace the current graph with the backup file?",
  "현재 그리드 {0}×{1}={2}칸 → 셀당 2개(fx,fy) 룩업, 총 삼항 {3}개(상한 {4} 이내 — 그대로 정확한 룩업으로 export됩니다).": "Current grid {0}×{1} = {2} cells → 2 lookups per cell (fx, fy), {3} ternaries in total (within the limit of {4} — exported as an exact lookup).",
  "현재: {0}{1}": "Current: {0}{1}",
  "회전 스텝(°) · emitter_age 1초당 누적": "Rotation step (°) · per second of emitter_age",
  "회전각/순환오프셋이 v.emitter_age(이미터가 켜진 뒤 계속 흐르는 초 단위 전역 시간)에 비례해 누적되는 속도의 배수. 1=기본 속도, 2=2배 빠르게, 0.5=절반 속도, 음수=역방향. 아래 speed 입력 소켓에 다른 노드(Formula 등)를 연결하면 이 숫자 필드 대신 그 수식 결과를 배수로 사용 — 노이즈 노드마다 서로 다른 속도(수식)를 줄 수 있다{0}.": "Multiplier for how fast the rotation angle / cycling offset builds up with v.emitter_age (global time in seconds since the emitter started). 1 = normal, 2 = twice as fast, 0.5 = half speed, negative = reverse. Connect another node (such as a Formula) to the speed input below to use its result instead of this number — so every noise node can have its own speed (or formula){0}.",
  "회전축 기울기 X(°)": "Axis tilt X (°)",
  "회전축 기울기 Y(°)": "Axis tilt Y (°)",
  "회전축 방향 (axisX, axisY, axisZ)": "Axis direction (axisX, axisY, axisZ)",
  "회전축 중심 회전 (emitter_age 비례, 매끄러움)": "Rotate around an axis (follows emitter_age, smooth)",
  "힘 벡터장(흐름) 미리보기": "Force field (flow) preview",
  "＋ 노드 추가": "＋ Add node",
  "＋ 노드 추가 · 라이브러리": "＋ Add node · Library",
  "🎆 3D 프리뷰": "🎆 3D Preview",
  "🎮 변수 (미리보기 값)": "🎮 Variables (preview values)",
  "💾 탭": "💾 Tab",
  "📦 .mcpack 내보내기": "📦 Export .mcpack",
  " · 방향 없음 {0}": " · no direction {0}",
  "소수점 {0}자리": "{0} decimals",
  "컴파일 소수점 정밀도 (6 → 10 → 15자리). 높을수록 정확하지만 식이 조금 길어집니다": "Compile decimal precision (6 → 10 → 15 digits). Higher is more accurate but makes formulas a little longer",
  "ORE perspective preview: WebGL 사용 불가 → 삼각형 분할로 그림": "ORE perspective preview: WebGL unavailable → drawing with triangle subdivision",
  "ORE WebGL preview가 느려서({0}ms) 2D 방식으로 전환": "ORE WebGL preview is slow ({0}ms) → switching to 2D drawing",
  "ORE WebGL preview 실패 → 다음 프레임부터 2D로 그림": "ORE WebGL preview failed → drawing in 2D from the next frame",
  "· 방향 없음 {0}": "· no direction {0}",
  "{0} · 방향 없음 {1}": "{0} · no direction {1}",
  "소수점": "Decimals",
  "자리": "digits",
  "ORE WebGL preview가 느려서(": "ORE WebGL preview is slow (",
  "ms) 2D 방식으로 전환": "ms) → switching to 2D drawing",
  "🔗 노드": "🔗 Nodes"
};
const ORE_KO_RE = /[가-힣]/;
let _oreI18nPats = null;
const _oreI18nCache = new Map();
const _oreI18nMemo = new Map(); // normalized text → English or null (also for parts of messages)
function oreLang(){ return globalThis.ORE_LANG === 'ko' ? 'ko' : 'en'; }
function _oreI18nCompile(){
  _oreI18nPats = [];
  for (const k of Object.keys(ORE_I18N_EN)) {
    if (!/\{\d+\}/.test(k)) continue;
    const parts = k.split(/(\{\d+\})/).filter(x => x !== '').map(x => { const m = /^\{(\d+)\}$/.exec(x); return m ? { ph: m[1] } : { lit: x }; });
    const src = parts.map(x => x.ph !== undefined ? '([\\s\\S]*?)' : x.lit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('');
    _oreI18nPats.push({ re: new RegExp('^' + src + '$'), parts, en: ORE_I18N_EN[k], lit: k.replace(/\{\d+\}/g, '').length });
  }
  _oreI18nPats.sort((a, b) => b.lit - a.lit); // more specific (longer fixed text) first
}
// Find values for the placeholders so that every Korean value can itself be translated.
// Needed when two placeholders sit side by side ("{0}{1}") and the regex alone can split them wrongly.
function _oreSplit(parts, s, pos, i, vals, depth){
  if (i === parts.length) return pos === s.length ? vals : null;
  const p = parts[i];
  if (p.lit !== undefined) return s.startsWith(p.lit, pos) ? _oreSplit(parts, s, pos + p.lit.length, i + 1, vals, depth) : null;
  const next = parts[i + 1];
  for (let e = pos; e <= s.length; e++) {
    if (next && next.lit !== undefined && !s.startsWith(next.lit, e)) continue;
    const v = s.slice(pos, e);
    let tv = v;
    if (ORE_KO_RE.test(v)) { const t = _oreT(v.trim(), depth + 1); if (t === null) continue; tv = v.replace(v.trim(), () => t); }
    const r = _oreSplit(parts, s, e, i + 1, Object.assign({}, vals, { [p.ph]: tv }), depth);
    if (r) return r;
  }
  return null;
}
function _oreT(s, depth){
  const norm = s.replace(/\s+/g, ' ');
  const hit = ORE_I18N_EN[norm];
  if (hit !== undefined) return hit;
  if (depth > 12) return null;
  if (_oreI18nMemo.has(norm)) return _oreI18nMemo.get(norm);
  if (!_oreI18nPats) _oreI18nCompile();
  let out = null, loose = null;
  for (const p of _oreI18nPats) {
    const m = p.re.exec(norm);
    if (!m) continue;
    const vals = _oreSplit(p.parts, norm, 0, 0, {}, depth);
    if (vals) { out = p.en.replace(/\{(\d+)\}/g, (_, n) => vals[n] !== undefined ? vals[n] : ''); break; }
    // No clean split: keep the first specific match as a fallback (Korean parts stay as they are, e.g. a user's own name).
    // Very short patterns like "{0}개" are never used this way — they would grab unrelated sentences.
    if (loose === null && p.lit >= 4) {
      const v2 = {}; let k = 1;
      p.parts.forEach(x => { if (x.ph !== undefined) v2[x.ph] = m[k++]; });
      loose = p.en.replace(/\{(\d+)\}/g, (_, n) => v2[n] !== undefined ? v2[n] : '');
    }
  }
  if (out === null) out = loose;
  if (_oreI18nMemo.size > 5000) _oreI18nMemo.clear();
  _oreI18nMemo.set(norm, out);
  return out;
}
// Text shown as several lines, or with an icon in front ("✔ ", "⚠ ", "✔ ⚡ "): translate line by line,
// keeping any leading symbols. Used only when the whole text has no entry.
function _oreTLines(s){
  let changed = false;
  const out = s.split('\n').map(line => {
    if (!ORE_KO_RE.test(line)) return line;
    const whole = /^(\s*)([\s\S]*?)(\s*)$/.exec(line);
    let t = _oreT(whole[2], 0);
    if (t !== null) { changed = true; return whole[1] + t + whole[3]; }
    const m = /^([^\p{L}\p{N}]*)([\s\S]*?)(\s*)$/u.exec(line); // leading symbols/spaces, then the text
    if (!m[1]) return line;
    t = _oreT(m[2], 0);
    if (t === null) return line;
    changed = true; return m[1] + t + m[3];
  });
  return changed ? out.join('\n') : null;
}
// Translate one finished string for display. Keeps leading/trailing spaces.
function oreT(s){
  if (typeof s !== 'string' || oreLang() === 'ko' || !ORE_KO_RE.test(s)) return s;
  const c = _oreI18nCache.get(s);
  if (c !== undefined) return c;
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s);
  let out = null;
  // Text with line breaks is shown line by line, so translate line by line first (keeps the breaks)
  if (m[2].includes('\n')) out = _oreTLines(s);
  if (out === null || ORE_KO_RE.test(out)) { const t = _oreT(m[2], 0); if (t !== null) out = m[1] + t + m[3]; } // whole-text entry wins over a partial line-by-line result
  if (out === null) out = _oreTLines(s);
  if (out === null) out = s;
  if (_oreI18nCache.size > 5000) _oreI18nCache.clear();
  _oreI18nCache.set(s, out);
  return out;
}

/* -------------------------------------------------------------------------
   1. 수식 파서: 사용자 수식 문자열 → Molang 표현식
   ------------------------------------------------------------------------- */
const FUNC_MAP = {
  sin:'math.sin', cos:'math.cos', tan:'math.tan', asin:'math.asin', acos:'math.acos', atan:'math.atan', atan2:'math.atan2',
  abs:'math.abs', sqrt:'math.sqrt', pow:'math.pow',
  floor:'math.floor', trunc:'math.trunc', ceil:'math.ceil', round:'math.round',
  lerp:'math.lerp', min:'math.min', max:'math.max', clamp:'math.clamp',
  random:'math.random', hermite:'math.hermite_blend', mod:'math.mod', ln:'math.ln', exp:'math.exp',
};
// 수식 안에서 쓸 수 있는 내장 Molang 변수 축약형(사용자 varMap보다 우선순위 낮음 — a/b/c/d 등
// 노드 소켓 이름과 겹치면 소켓이 우선). Bedrock 파티클 Molang 컨텍스트 변수:
// https://bedrock.dev/docs/stable/Particles 참고 — v.particle_age(파티클 개별 생존 시간),
// v.emitter_age(이미터가 켜진 뒤 계속 흐르는 전역 시간).
const BUILTIN_VAR_ALIASES = {
  pa:'v.particle_age', ea:'v.emitter_age',
  // 랜덤: pr1~pr4 = v.particle_random_1~4 (pr = pr1), er1~er4 = v.emitter_random_1~4 (er = er1)
  pr:'v.particle_random_1', pr1:'v.particle_random_1', pr2:'v.particle_random_2', pr3:'v.particle_random_3', pr4:'v.particle_random_4',
  er:'v.emitter_random_1', er1:'v.emitter_random_1', er2:'v.emitter_random_2', er3:'v.emitter_random_3', er4:'v.emitter_random_4',
  // pl = 파티클 "실제" 수명(초). v.particle_lifetime은 이 파이프라인에서 id 인코딩값이라 쓸 수 없으므로
  // 컴파일러가 creation_expression에 넣어 두는 v.ore_pl(실제 수명)로 연결한다. el = v.emitter_lifetime(이미터 active_time).
  pl:'v.ore_pl', el:'v.emitter_lifetime',
};

class FormulaParser{
  constructor(expr, varMap){
    this.tokens = this.tokenize(expr);
    this.pos = 0;
    this.varMap = varMap || {};
  }
  tokenize(expr){
    const re = /\s*(?:(\d+\.?\d*)|([a-zA-Z_][a-zA-Z0-9_]*)|([+\-*/^(),]))\s*/g;
    const tokens=[]; let m; let last=0;
    while((m=re.exec(expr))!==null){
      if(m.index>last && expr.slice(last,m.index).trim()!=='') throw new Error(`인식 불가 문자: '${expr.slice(last,m.index).trim()}'`);
      if(m[1]!==undefined) tokens.push({type:'num',value:m[1]});
      else if(m[2]!==undefined) tokens.push({type:'id',value:m[2]});
      else if(m[3]!==undefined) tokens.push({type:'op',value:m[3]});
      last = re.lastIndex;
      if(m[0].length===0) re.lastIndex++;
    }
    return tokens;
  }
  peek(){return this.tokens[this.pos];}
  next(){return this.tokens[this.pos++];}
  parse(){
    if(this.tokens.length===0) throw new Error('빈 수식');
    const r=this.parseExpr();
    if(this.pos<this.tokens.length) throw new Error(`예상치 못한 토큰 '${this.peek().value}'`);
    return r;
  }
  parseExpr(){
    let left=this.parseTerm();
    while(this.peek() && this.peek().type==='op' && (this.peek().value==='+'||this.peek().value==='-')){
      const op=this.next().value; const right=this.parseTerm();
      left=`(${left}${op}${right})`;
    }
    return left;
  }
  parseTerm(){
    let left=this.parsePow();
    while(this.peek() && this.peek().type==='op' && (this.peek().value==='*'||this.peek().value==='/')){
      const op=this.next().value; const right=this.parsePow();
      left=`(${left}${op}${right})`;
    }
    return left;
  }
  parsePow(){
    let left=this.parseUnary();
    if(this.peek() && this.peek().type==='op' && this.peek().value==='^'){
      this.next(); const right=this.parsePow();
      left=`math.pow(${left},${right})`;
    }
    return left;
  }
  parseUnary(){
    if(this.peek() && this.peek().type==='op' && this.peek().value==='-'){
      this.next(); return `(-${this.parseUnary()})`;
    }
    return this.parsePrimary();
  }
  parsePrimary(){
    const tok=this.peek();
    if(!tok) throw new Error('수식이 예기치 않게 종료됨');
    if(tok.type==='num'){ this.next(); return tok.value; }
    if(tok.type==='op' && tok.value==='('){
      this.next(); const inner=this.parseExpr();
      if(!this.peek()||this.peek().value!==')') throw new Error('닫는 괄호 누락');
      this.next(); return `(${inner})`;
    }
    if(tok.type==='id'){
      this.next();
      if(this.peek() && this.peek().type==='op' && this.peek().value==='('){
        const fname=FUNC_MAP[tok.value.toLowerCase()];
        if(!fname) throw new Error(`알 수 없는 함수: ${tok.value}`);
        this.next();
        const args=[];
        if(this.peek() && this.peek().value!==')'){
          args.push(this.parseExpr());
          while(this.peek() && this.peek().value===','){ this.next(); args.push(this.parseExpr()); }
        }
        if(!this.peek()||this.peek().value!==')') throw new Error(`${tok.value}() 닫는 괄호 누락`);
        this.next();
        return `${fname}(${args.join(',')})`;
      }
      const key=tok.value.toLowerCase();
      if(this.varMap[key]) return this.varMap[key];
      if(BUILTIN_VAR_ALIASES[key]) return BUILTIN_VAR_ALIASES[key]; // pa→v.particle_age, ea→v.emitter_age
      return `v.${tok.value}`; // 매핑 안된 변수는 커스텀 변수로 허용
    }
    throw new Error(`예상치 못한 토큰: '${tok.value}'`);
  }
}
function compileFormula(expr, varMap){ return new FormulaParser(expr, varMap).parse(); }
/* [v1.1.6] 컴파일 소수점 정밀도. 내보내는 식에 들어가는 계산된 숫자(스텝 시각·계수·상수 등)를 이 자릿수까지 쓴다.
   지수 표기(1e-7)는 쓰지 않고, 끝의 0은 지운다. 자릿수가 클수록 정확하지만 식이 조금 길어진다. */
globalThis.ORE_PREC = 10;
function pnum(v, d){
  v=+v; if(!isFinite(v)) return '0';
  d = Math.max(0, Math.min(20, d===undefined ? globalThis.ORE_PREC : d));
  let s=v.toFixed(d);
  if(s.indexOf('.')>=0) s=s.replace(/0+$/,'').replace(/\.$/,'');
  if(s==='-0') s='0';
  return s;
}
const DT60 = ()=>pnum(1/60), RAD2DEG = ()=>pnum(180/Math.PI);

/* -------------------------------------------------------------------------
   2. Shape 프리셋 10종 — 사용자가 보낸 예제의 나선형 포함
      각 프리셋은 x,y,z 세 수식(사용 가능 변수: j, n, h, seed)
      r1/r2/rs 같은 "전용 상수"는 별도 필드/소켓으로 두지 않는다 — 프리셋을 고르면
      해당 프리셋의 기본 파라미터 값이 수식 문자열에 리터럴로 바로 치환되어 커스텀
      수식 입력창에 채워진다. 그 뒤로는 순수 텍스트 수식이므로 자유롭게 편집하면 된다
      (필요하면 숫자를 바꾸거나, 아예 새로운 항을 더 넣거나 지워도 됨).
   ------------------------------------------------------------------------- */
// 원본 예제(a:c)의 반지름 보간 트릭: r(p) = r2 + (r1-r2)*(1-rs)*p^2
// p = |y_norm| (중심=0, 끝=1). rs=0이면 완전 보간(포물선), rs=1이면 항상 r2(균일).
// height 기반 프리셋에서 이 표현을 재사용하기 위한 매크로 문자열(변수명 그대로 유지 —
// 프리셋 불러오기 시 아래 substParams()가 r1/r2/rs 자리를 리터럴 숫자로 치환한다).
const RADIUS_BLEND = 'r2+(r1-r2)*(1-rs)*pow(abs((j/(n-1)*h-h/2)/(h/2)),2)';

const SHAPE_PRESETS = [
  { id:'spiral', name:'나선형 (Spiral)', desc:'예제와 동일 · 황금각 나선 방추(포물선 반지름 보간)',
    params:{r1:1, r2:0.4, rs:0},
    x:`(${RADIUS_BLEND}) * cos(j*137.507764)`,
    y:'j/(n-1)*h-h/2',
    z:`(${RADIUS_BLEND}) * sin(j*137.507764)` },
  { id:'sphere', name:'구 (Sphere)', desc:'피보나치 구면 분포',
    params:{r1:1},
    x:'r1*sqrt(1-pow(1-2*(j+0.5)/n,2)) * cos(j*137.507764)',
    y:'r1*(1-2*(j+0.5)/n)',
    z:'r1*sqrt(1-pow(1-2*(j+0.5)/n,2)) * sin(j*137.507764)' },
  { id:'disc', name:'원판 (Disc)', desc:'수평 원판 위에 균일 분포',
    params:{r1:1},
    x:'r1*sqrt(j/n) * cos(j*137.507764)',
    y:'0',
    z:'r1*sqrt(j/n) * sin(j*137.507764)' },
  { id:'ring', name:'링 (Ring)', desc:'고정 반지름 원형 링',
    params:{r1:1},
    x:'r1*cos(j/n*360)', y:'0', z:'r1*sin(j/n*360)' },
  { id:'cylinder', name:'원기둥 (Cylinder)', desc:'반지름 보간 가능한 실린더/장구형',
    params:{r1:1, r2:0.4, rs:0},
    x:`(${RADIUS_BLEND}) * cos(j*137.507764)`,
    y:'j/(n-1)*h-h/2',
    z:`(${RADIUS_BLEND}) * sin(j*137.507764)` },
  { id:'cone', name:'원뿔 (Cone)', desc:'위로 갈수록 좁아지는 나선(포물선 보간 가능)',
    params:{r1:1, r2:0.4, rs:0},
    x:`(r1+(r2-r1)*(1-rs)*pow(j/n,2)) * cos(j*137.507764)`,
    y:'j/(n-1)*h-h/2',
    z:`(r1+(r2-r1)*(1-rs)*pow(j/n,2)) * sin(j*137.507764)` },
  { id:'cube', name:'큐브 격자 (Cube Grid)', desc:'입방 격자 분포(근사)',
    params:{},
    x:'(mod(j,10)/10-0.5)*h', y:'(mod(floor(j/10),10)/10-0.5)*h', z:'(floor(j/100)/10-0.5)*h' },
  { id:'helix', name:'이중 나선 (Double Helix)', desc:'DNA 형태 이중 나선(반지름 보간 가능)',
    params:{r1:1, r2:0.4, rs:0},
    x:`(${RADIUS_BLEND}) * cos(j/n*720)`,
    y:'j/(n-1)*h-h/2',
    z:`(${RADIUS_BLEND}) * sin(j/n*720)` },
  { id:'wave', name:'사인 웨이브 (Sine Wave)', desc:'수평 파형 배치',
    params:{r1:1},
    x:'(j/(n-1)*h-h/2)', y:'r1*sin(j/n*720)', z:'0' },
  { id:'cloud', name:'랜덤 구름 (Random Cloud)', desc:'해시 기반 의사난수 분포',
    params:{r1:1},
    x:'(random(j*12.9898+seed)-0.5)*r1*2', y:'(random(j*78.233+seed)-0.5)*h', z:'(random(j*45.164+seed)-0.5)*r1*2' },
];

// 프리셋 수식 문자열의 r1/r2/rs 변수 자리를 실제 숫자 리터럴로 치환한다(단어 경계 기준).
// 결과는 순수 j/n/h/seed 수식이 되어, 더 이상 "r1/r2/rs라는 전용 슬롯"이 필요 없다.
function substParams(expr, params){
  return expr.replace(/\b(r1|r2|rs)\b/g, (m)=> String(params[m]!==undefined?params[m]:(m==='rs'?0:1)));
}

/* -------------------------------------------------------------------------
   3. 상태 관리
   ------------------------------------------------------------------------- */
const state = {
  nodes: {},      // id -> node
  wires: {},      // id -> {from:{node,socket}, to:{node,socket}}
  nextId: 1,
  selectedNode: null,
  scale: 1, panX: -300, panY: -80,
  pack: { name:'', desc:'', icon:'' }, // [v1.0.12] .mcpack 이름·설명·아이콘(dataURL). 탭마다 따로 가진다.
};

function uid(prefix){ return `${prefix}_${state.nextId++}`; }

// 노드 타입 정의: 각 타입의 기본 데이터, 입력/출력 소켓
const NODE_DEFS = {
  emitter:{
    label:'Emitter', color:'var(--node-emitter)',
    // bone: seed 출력 바로 아래에 추가된 출력 소켓. 값 자체는 Emitter 본문에서 입력한
    // 텍스트 필드(뼈대/로케이터 이름)를 그대로 흘려보내는 문자열 출력이다. Bedrock 파티클
    // JSON 자체에는 "bone"이라는 필드가 없다 — 엔티티에 파티클을 부착할 때 사용하는
    // locator/bone 이름은 이벤트(type: emitter_bound)나 엔티티 리소스 정의 쪽 정보이므로,
    // 이 값은 Event 노드가 Sub Emitter를 발동시킬 때 "어느 본에 붙일지"를 결정하는 데
    // 쓰인다(Event 노드의 bindToBone 옵션 참고).
    outputs:[{k:'j', label:'j (index)'}, {k:'n', label:'n (count)'}, {k:'h', label:'h (height)'}, {k:'seed', label:'seed'}, {k:'bone', label:'bone'}],
    inputs:[],
    // r1/r2/rs는 더 이상 전용 필드/소켓으로 존재하지 않는다 — 어차피 수식으로 표현 가능하므로
    // Shape 노드의 커스텀 수식(x/y/z) 안에 리터럴로 직접 들어간다(프리셋 불러오기 시 자동 치환).
    // material/texture_width/texture_height는 basic_render_parameters·billboard.uv에 매핑되는
    // 렌더링 설정(값 자체가 상수여야 하는 Bedrock 스펙 제약)이라 Emitter에 둔다.
    defaults:{ count:200, height:5, seed:42, lifetimeSeconds:1, texture:'textures/blocks/wool_colored_white',
      material:'particles_add', textureWidth:16, textureHeight:16, bone:'',
      facingMode:'rotate_xyz', billboardDirMode:'none', minSpeedThreshold:0.01,
      emitMode:'burst', spawnRate:30, maxParticles:200, particleLife:1, steadyLoop:false,
      // [v1.0.12] particleId: 내보낼 identifier(비우면 자동) · displayName: 에디터 표시용 명칭(JSON에는 안 들어감)
      // localSpace: minecraft:emitter_local_space를 내보낼지(엔티티/로케이터에 붙여 쓸 때). 꺼져 있으면 출력 변화 없음.
      particleId:'', displayName:'', localSpace:false, lsPosition:true, lsRotation:true, lsVelocity:true },
  },
  // sub_emitter: Emitter와 데이터/출력이 완전히 동일하지만, 입력으로 'bone' 소켓이 하나 더 있다.
  // 이 입력에 (Emitter 또는 다른 Sub Emitter의) bone 출력을 연결하면, 이 서브이미터가
  // Event를 통해 발동될 때 그 본/로케이터에 부착된다(emitter_bound 타입으로 내보내짐).
  // 미연결이면 월드 좌표에 그냥 생성된다(emitter 타입으로 내보내짐).
  // Sub Emitter는 독립적인 완전한 파티클 effect이므로 자기 자신의 Shape/Noise/Formula/Output
  // 체인을 따로 구성해서 별도의 identifier로 export된다 — Event 노드가 그 identifier를
  // particle_effect 이벤트로 참조해 트리거한다.
  sub_emitter:{
    label:'Sub Emitter', color:'var(--node-subemitter)',
    outputs:[{k:'j', label:'j (index)'}, {k:'n', label:'n (count)'}, {k:'h', label:'h (height)'}, {k:'seed', label:'seed'}, {k:'bone', label:'bone'}],
    // trigger: 이 Sub Emitter를 실제로 발동시키는 Event의 fire 출력을 받는 입력.
    //          미연결이면 export 시 "발동시키는 Event가 없다"는 안내와 함께 스킵된다.
    // bone   : 상류 Emitter/Sub Emitter의 bone 출력을 연결하면 같은 본에 부착되어 발동(emitter_bound).
    inputs:[{k:'trigger', label:'trigger ← event.fire'}, {k:'bone', label:'bone (입력)'}],
    defaults:{ count:200, height:5, seed:42, lifetimeSeconds:1, texture:'textures/blocks/wool_colored_white',
      material:'particles_add', textureWidth:16, textureHeight:16, bone:'',
      facingMode:'rotate_xyz', billboardDirMode:'none', minSpeedThreshold:0.01,
      emitMode:'burst', spawnRate:30, maxParticles:200, particleLife:1, steadyLoop:false,
      // [v1.0.12] particleId: 내보낼 identifier(비우면 자동) · displayName: 에디터 표시용 명칭(JSON에는 안 들어감)
      // localSpace: minecraft:emitter_local_space를 내보낼지(엔티티/로케이터에 붙여 쓸 때). 꺼져 있으면 출력 변화 없음.
      particleId:'', displayName:'', localSpace:false, lsPosition:true, lsRotation:true, lsVelocity:true },
  },
  // event: Emitter/Sub Emitter의 "발동 조건"을 담당하는 중계 노드.
  // 입력 소켓 하나(trigger)로 어느 Emitter/Sub Emitter가 이 이벤트를 갖는지 연결하고,
  // 출력 소켓(fire)을 다음 Sub Emitter의 trigger 입력에 연결하면 체이닝된다:
  //   Emitter -> Event -> Sub Emitter -> Event -> Sub Emitter -> ...
  // condition: 이벤트가 언제 발동하는지(creation/expiration/timeline) — Bedrock의
  // minecraft:emitter_lifetime_events 컴포넌트에 그대로 대응.
  // copy* 체크박스들: 발동원(Emitter/Sub Emitter)의 어떤 값들을 pre_effect_expression으로
  // 서브이미터 쪽에 복사해 넘길지 선택 — 즉 "출력에 복사할 것"을 고를 수 있게 한다.
  event:{
    label:'Event', color:'var(--node-event)',
    outputs:[{k:'fire', label:'fire → sub_emitter'}],
    inputs:[{k:'trigger', label:'trigger ← emitter/sub_emitter'}],
    defaults:{
      condition:'creation',      // creation | expiration | timeline
      timelineTime:0.5,          // condition==='timeline'일 때 사용(초)
      bindToBone:true,           // 발동원의 bone 출력을 emitter_bound로 이어받을지
      copySeed:true, copyPos:false, copyColor:false,
    },
  },
  // [v1.0.12] particle_event: Event와 같은 자리에 꽂지만 "이미터"가 아니라 "파티클 하나하나"의 생애에서 발동한다.
  // Bedrock의 minecraft:particle_lifetime_events(creation_event / expiration_event / timeline)로 내보내진다.
  // 한 번 발동할 때 할 수 있는 일(문서의 이벤트 구성요소): fire에 연결된 Sub Emitter 생성(particle_effect),
  // 소리 재생(sound_effect.event_name), Molang 실행(expression). 파티클이 많으면 그만큼 여러 번 발동하므로 주의.
  particle_event:{
    label:'Particle Event', color:'var(--node-event)',
    outputs:[{k:'fire', label:'fire → sub_emitter'}],
    inputs:[{k:'trigger', label:'trigger ← emitter/sub_emitter'}],
    defaults:{
      condition:'expiration',   // creation | expiration | timeline (파티클 기준)
      timelineTime:0.5,         // condition==='timeline'일 때: 파티클이 태어난 뒤 몇 초에 발동할지
      spawnType:'emitter',      // particle_effect.type: emitter | emitter_bound
      sound:'',                 // sound_effect.event_name (비우면 소리 없음)
      expr:'',                  // expression: 발동한 이미터에서 실행할 Molang (비우면 없음)
    },
  },
  shape:{
    label:'Shape', color:'var(--node-shape)',
    outputs:[{k:'x', label:'x'}, {k:'y', label:'y'}, {k:'z', label:'z'}],
    inputs:[{k:'j', label:'j'}, {k:'n', label:'n'}, {k:'h', label:'h'}, {k:'seed', label:'seed'}],
    // custom 플래그 제거: Shape는 항상 커스텀 x/y/z 수식만 가진다. 프리셋은 "이 수식으로
    // 시작하기" 버튼일 뿐 — 고르는 순간 그 프리셋의 r1/r2/rs 리터럴이 채워진 완성된 수식이
    // exprX/Y/Z에 들어가고, 그 뒤로는 자유 텍스트 편집이다.
    defaults:{ preset:'spiral', exprX:'', exprY:'', exprZ:'' },
  },
  // shape_image_contour: Shape 계열의 이미지 기반 노드. 업로드한 이미지에서 밝기/알파/RGB 채널
  // 기준으로 실루엣을 이진화하고, 외곽선을 한 바퀴 추적한 뒤 등간격으로 재샘플링해 Elliptic
  // Fourier Descriptors(Kuhl & Giardina 1982 — pyefd/ElliShape 등 실무 형태 분석 도구가 쓰는
  // 표준 기법)로 x(t)/y(t)를 각각 코사인+사인 급수로 피팅한다. Bedrock Molang은 런타임에
  // 텍스처를 샘플링할 수 없으므로, 이렇게 미리 구한 다항식(삼각함수 합)을 Shape 노드와 동일한
  // exprX/Y/Z 문법으로 그대로 출력한다 — 즉 "이미지 외곽선을 따라 파티클이 배치되는 Shape".
  // j(파티클 인덱스)가 외곽선 매개변수 t=0~360°에 매핑되어, n개 파티클이 윤곽선 전체를 고르게 나눠 맡는다.
  shape_image_contour:{
    label:'Shape (Image Contour)', color:'var(--node-shape)',
    outputs:[{k:'x', label:'x'}, {k:'y', label:'y'}, {k:'z', label:'z'}],
    inputs:[{k:'j', label:'j'}, {k:'n', label:'n'}, {k:'h', label:'h'}, {k:'seed', label:'seed'}],
    defaults:{
      imageDataUrl:null,       // base64 원본 이미지(저장/불러오기 시 함께 보존)
      imageName:'',
      traceMode:'luminance',   // luminance(밝기) | alpha(알파채널) | redchan/greenchan/bluechan(RGB 채널)
      threshold:0.5,           // 이진화 기준값(0~1) — 이 값 이상을 전경(안쪽)으로 취급
      invertMask:false,        // 전경/배경 반전
      traceResolution:128,     // 외곽선 추적용 그리드 한 변 해상도(정밀도 · 클수록 느려짐)
      resampleCount:120,       // 외곽선을 등간격으로 재샘플링할 점 개수(덩어리마다 동일하게 적용)
      harmonicOrder:10,        // EFD 하모닉 차수(높을수록 뾰족한 디테일까지 근사, 수식은 길어짐)
      maxContours:4,           // 찾을 최대 덩어리(연결 성분) 개수 — 이미지 안에 분리된 도형이 여러 개면
                                // 각각 외곽선을 추적해 둘레(perimeter) 비례로 파티클을 자동 분배한다.
      xzScale:2,               // 정규화된 외곽선(-1~1)에 곱할 월드 스케일(원 크기)
      flipY:true,              // 이미지 y축(아래+)을 월드 z축(위+ 관례)으로 뒤집을지
      rotateOffsetDeg:0,       // 파티클이 t=0에서 시작하는 위치를 j 진행 방향으로 얼마나 돌릴지(도)
      yExpr:'0',               // Shape의 y(높이) 수식 — 기본은 평면(0), 필요시 j/n/h 등으로 편집 가능
      efd:null,                // (구버전 호환용) 첫 번째 덩어리의 EFD — {a0,c0,harmonics:[...],perimeter}
      efdList:null,            // 베이크 결과: [{efd,weight,cumStart,cumEnd,perimeter}, ...] 덩어리별 배열
      tracedPreview:null,      // 미리보기용 원본 추적 데이터(마스크 + 덩어리별 재샘플 점)
      contourError:null,
      generatedExprX:'', generatedExprZ:'', // 마지막으로 생성된 수식 문자열(읽기전용 표시용)
    },
  },
  noise3d:{
    label:'Noise 3D', color:'var(--node-noise-static)',
    // timing 고정값 없음 — 이 노드는 "중앙형/분산형" 구분이 없다. 출력 n이 최종적으로
    // 어느 소켓(들)에 연결되는지를 컴파일러가 역추적해서 자동으로 결정한다:
    //   - offset(once) 경로에만 연결 → 그 자리에서 1회만 계산(예전 "중앙집중형"과 동일 동작)
    //   - tint/size(perframe) 경로에 연결 → max_lifetime에 저장된 id(v.i, 정수 그대로·양자화 없음)를
    //     역산해서 좌표 계산부터 노이즈까지 파티클 개개인이 매 프레임 통째로 재계산(예전 "완전 분산형").
    //   - 양쪽에 동시에 연결 → 두 컨텍스트에서 각각 독립적으로 재계산(중복 생성, 정상 동작).
    // 이 노드의 x/y/z/seed 입력에 연결된 상류 노드(Shape 등)도 필요한 컨텍스트에서 함께
    // 재계산된다 — 즉 노이즈 출력에서 역추적되는 모든 노드가 자동으로 같은 컨텍스트로 끌려온다.
    outputs:[{k:'n', label:'noise'}],
    // scale/amplitude: 입력 소켓에 연결되면 그 상류 수식을(컨텍스트별로) 그대로 쓰고, 미연결이면
    // 아래 숫자 필드(node.data.scale/amplitude)를 리터럴로 쓴다(directionalfield.strength와 동일 패턴).
    inputs:[{k:'x', label:'x'}, {k:'y', label:'y'}, {k:'z', label:'z'}, {k:'seed', label:'seed'}, {k:'speed', label:'speed'},
      {k:'scale', label:'scale (입력, 선택)'}, {k:'amplitude', label:'amplitude (입력, 선택)'}],
    // rotateEnabled: 임의 축(회전축은 tiltX/tiltY로 지정) 중심 노이즈 샘플링 좌표 회전.
    // rotateStep: v.emitter_age(이미터가 켜진 뒤 계속 흐르는 초 단위 전역 시간) 1초당 더해지는
    //   회전각(도) — 세대(파티클 묶음) 단위 계단식이 아니라 매 프레임 연속으로 부드럽게 흐른다.
    //   아래 speed 배수가 곱해진다.
    // tiltX/tiltY: 회전축 방향을 정하는 기울기 각도(도). 기본축 Y(0,1,0)에서 X축 기준으로 tiltX만큼,
    //   그 다음 Y축 기준으로 tiltY만큼 기울여 최종 회전축을 만든다. 둘 다 0이면 기존과 동일한 순수 Y축 회전.
    // cycleOffsetEnabled/cycleOffsetStep(X/Y/Z): v.emitter_age 1초당 누적되는 오프셋 증분(리셋 없음).
    //   노이즈 샘플링 좌표 p(x,y,z)에 더해진다. 이것도 emitter_age 기반이라 매 프레임 매끄럽게 흐른다.
    // speed: 순환 오프셋(회전각 + cycleOffset) 진행 속도 배수. rotateStep/cycleOffsetStep에 이
    //   배수를 곱해서 emitter_age와 함께 누적한다 — 값이 클수록 노이즈가 더 빨리 흐른다(예: speed=2
    //   → emitter_age*2와 같은 효과). 숫자 필드가 기본값이며, speed 입력 소켓에 다른 노드(Formula
    //   등)를 연결하면 그 수식 결과로 대체된다 — 노이즈 노드마다 서로 다른 속도(수식)를 쓸 수 있다.
    defaults:{ scale:0.5, amplitude:1, seed:42, rotateEnabled:true, rotateStep:6, tiltX:0, tiltY:0,
      cycleOffsetEnabled:false, cycleOffsetStepX:0, cycleOffsetStepY:0.001, cycleOffsetStepZ:0, speed:1,
      // noiseType: 실제 VFX 프로그램(Unity VFX Graph/Shader Graph, Houdini 등)에서 표준으로 제공하는
      // 노이즈 종류. perlin(그라디언트 노이즈, 기존 방식) / simplex(단순화된 격자, 방향성 아티팩트가
      // 적음) / voronoi(셀룰러/Worley 노이즈 — 균열·비늘·돌 질감) / fbm(Perlin을 여러 옥타브로 겹쳐
      // 디테일을 더한 프랙탈 노이즈 — 구름·연기·불 질감의 기본).
      noiseType:'perlin',
      octaves:3, lacunarity:2.0, gain:0.5,           // fbm 전용: 옥타브 수 · 주파수 배율 · 진폭 감쇠율
      cellDensity:2, voronoiSmooth:0,                 // voronoi 전용: 셀 밀도 · 경계 스무딩(0=칼같은 경계)
    },
  },
  // curlnoise: Perlin 노이즈의 회전(curl)을 이용해 만드는 발산 없는(비압축) 벡터장.
  // Unity VFX Graph의 "Perlin Curl Noise" Operator, Houdini의 pop curlnoise VOP와 동일한 개념 —
  // 파티클이 한 점으로 빨려들어가지 않고 소용돌이치듯 자연스럽게 흐르는 터뷸런스를 만든다
  // (연기/불/물처럼 매끄럽게 휘도는 유체 느낌의 움직임에 표준적으로 쓰임).
  curlnoise:{
    label:'Curl Noise', color:'var(--node-curl)',
    outputs:[{k:'fx', label:'force.x'}, {k:'fy', label:'force.y'}, {k:'fz', label:'force.z'}],
    inputs:[{k:'x', label:'x'}, {k:'y', label:'y'}, {k:'z', label:'z'}, {k:'seed', label:'seed'},
      {k:'scale', label:'scale (입력, 선택)'}, {k:'amplitude', label:'amplitude (입력, 선택)'}],
    // previewDensity: 미리보기 화살표 격자의 셀 크기(px). 값이 작을수록 화살표가 촘촘해짐(고밀도).
    // flowEnabled/flowSpeed: 노이즈 샘플링 좌표의 한 축(기본 z)에 시간(v.emitter_age)을 계속
    // 더해서 벡터장 패턴 자체가 한 방향으로 흘러가게 만드는 옵션 — noise3d의 cycleOffset과
    // 동일한 개념을 curl 벡터장에 적용한 것. Unity VFX Graph의 "Curl Noise" Operator가 Time
    // 입력을 3번째 좌표축으로 흘려보내 "고정된 패턴이 아니라 살아있는 듯 흐르는 난류"를 만드는
    // 표준적인 방식과 동일하다(그냥 좌표가 매 프레임 바뀌면 노이즈 자체가 시간에 따라 변한다).
    defaults:{
      scale:0.5, amplitude:1, seed:42, previewDensity:14,
      flowEnabled:false, flowSpeed:0.2, flowTimeSource:'emitter_age',
    },
  },
  // curlturb: Curl Noise를 여러 옥타브(fbm 방식)로 겹쳐 만드는 다중 스케일 터뷸런스 벡터장.
  // Houdini의 POP Turbulence / VOP "curlnoise"에 옥타브를 추가한 형태, Unity VFX Graph의
  // "Turbulence" Block(Multi-octave Curl Noise 옵션)과 동일한 개념 — 단일 curl noise는
  // 한 가지 크기의 소용돌이만 만들지만, 옥타브를 쌓으면 큰 소용돌이 위에 작은 소용돌이가
  // 겹쳐진 "연기/구름처럼 디테일이 살아있는" 난류를 만들 수 있다. 각 옥타브는 curlnoise와
  // 동일하게 6개 지점 유한차분으로 회전을 구하고, lacunarity(옥타브별 스케일 배율)·gain
  // (옥타브별 진폭 감쇠율)로 fbmNoiseMolang과 동일한 가중합 방식을 따른다.
  curlturb:{
    label:'Turbulence (Curl FBM)', color:'var(--node-curl)',
    outputs:[{k:'fx', label:'force.x'}, {k:'fy', label:'force.y'}, {k:'fz', label:'force.z'}],
    inputs:[{k:'x', label:'x'}, {k:'y', label:'y'}, {k:'z', label:'z'}, {k:'seed', label:'seed'},
      {k:'scale', label:'scale (입력, 선택)'}, {k:'amplitude', label:'amplitude (입력, 선택)'}],
    defaults:{
      scale:0.5, amplitude:1, seed:42, previewDensity:14,
      octaves:3, lacunarity:2.0, gain:0.5,   // fbmNoise3D와 동일 의미: 옥타브 수 · 옥타브당 주파수 배율 · 옥타브당 진폭 감쇠율
      flowEnabled:false, flowSpeed:0.2, flowTimeSource:'emitter_age', // curlnoise와 동일한 시간 흐름 옵션
    },
  },
  // vortexfield: 중심점(cx,cy,cz)과 축(axis) 둘레로 회전하는 소용돌이 힘. 축과의 최근접점까지의
  // 거리에 반지름 감쇠(falloff)를 적용해 힘 세기를 조절한다. Unity VFX Graph의 "Vortex" Block/
  // Operator, Unreal Niagara의 "Vortex Velocity Force"와 동일한 개념 — curl noise가 "무작위 난류"라면
  // vortex는 "질서정연한 단일 소용돌이"다. 태풍/회오리/블랙홀형 흡입 이펙트에 표준적으로 쓰인다.
  // v5: pulseEnabled/pulseFreq/pulseAmount — strength가 시간에 따라 sin파로 맥동하는 옵션을
  // 노드에 내장. Unity VFX Graph에서 "Vortex" Block의 Strength에 Sine 노드를 곱해 쓰는 흔한
  // 패턴, Unreal Niagara의 "Curl Noise Force"/"Vortex Velocity" 모듈이 Time 기반 스칼라를
  // Strength 파라미터에 바로 연결할 수 있는 것과 동일한 역할을 전용 필드로 제공한다.
  // strength 입력 소켓에 Formula(t)를 직접 연결해도 되지만(더 자유로운 커스텀 파형),
  // "그냥 태풍처럼 주기적으로 세졌다 약해지게" 정도는 소켓 배선 없이 필드만으로 바로 쓸 수 있게 함.
  vortexfield:{
    label:'Vortex Field', color:'var(--node-vortex)',
    outputs:[{k:'fx', label:'force.x'}, {k:'fy', label:'force.y'}, {k:'fz', label:'force.z'}],
    inputs:[{k:'x', label:'x'}, {k:'y', label:'y'}, {k:'z', label:'z'},
      {k:'strength', label:'strength (입력, 선택)'}, {k:'radius', label:'radius (입력, 선택)'},
      {k:'vx', label:'vel.x (입력, 선택)'}, {k:'vy', label:'vel.y (입력, 선택)'}, {k:'vz', label:'vel.z (입력, 선택)'}],
    defaults:{
      cx:0, cy:0, cz:0,          // 소용돌이 중심 좌표
      axisX:0, axisY:1, axisZ:0, // 회전축 방향(정규화되지 않아도 내부에서 정규화)
      strength:1,                // 회전 힘 세기(양수=반시계, 음수=시계 — 축 방향 기준)
      orbitRadius:0,             // [v10] 유입이 멈추는 궤도 반경 r0. 0=축까지 빨려듦(기존 동작), >0=그 반경의 고리에서 계속 회전
      inwardPull:0.5,            // 흐름의 반경 방향 유입(싱크) 비율. 0=순수 회전, 0.5=회전속도의 절반으로 중심으로 흘러듦
      core:0.3,                  // 코어 반경(Rankine/Lamb-Oseen 코어): 축 근처에서 회전속도가 0으로 부드럽게 수렴(축 특이점 제거)
      drag:1,                    // 유체-입자 결합 계수 k(1/s): 가속도 = k·(u_flow − v). vel 입력을 연결하면 입자가 흐름 속도를 따라가고, 미연결이면 v=0으로 보고 k·u가 됨
      radius:3,                  // 힘이 미치는 반경(월드 단위)
      falloff:1,                 // 반경 경계에서 감쇠하는 정도(0=경계까지 감쇠 없음, 1=선형 감쇠, 2=더 급격)
      previewDensity:14,
      pulseEnabled:false,        // strength를 시간에 따라 sin파로 맥동시킬지
      pulseFreq:1,               // 맥동 주파수(Hz에 가까움 — 클수록 빨리 진동)
      pulseAmount:0.5,           // 맥동 진폭 비율(0=변화 없음, 1이면 strength가 0~2배 사이를 오감)
      pulseTimeSource:'emitter_age', // 맥동 시간축: emitter_age(전역) | particle_age(개별 파티클)
    },
  },
  // attractorfield: 한 점을 향해 끌어당기거나(양수) 밀어내는(음수) 방사형 힘. Unity VFX Graph의
  // "Sphere"(Attraction/Force), Unreal Niagara의 "Point Attraction Force"와 동일한 개념.
  // 거리 감쇠 방식(linear/inverse-square)을 선택할 수 있어 자석형 흡입, 폭발 척력, 블랙홀형
  // 이펙트 등 다양한 용도에 쓰인다.
  attractorfield:{
    label:'Attractor / Point Force', color:'var(--node-attractor)',
    outputs:[{k:'fx', label:'force.x'}, {k:'fy', label:'force.y'}, {k:'fz', label:'force.z'}],
    inputs:[{k:'x', label:'x'}, {k:'y', label:'y'}, {k:'z', label:'z'},
      {k:'strength', label:'strength (입력, 선택)'}, {k:'radius', label:'radius (입력, 선택)'},
      {k:'vx', label:'vel.x (입력, 선택)'}, {k:'vy', label:'vel.y (입력, 선택)'}, {k:'vz', label:'vel.z (입력, 선택)'}],
    defaults:{
      cx:0, cy:0, cz:0,     // 인력/척력의 중심 좌표
      strength:1,           // 힘 세기(양수=끌어당김/attraction, 음수=밀어냄/repulsion)
      radius:3,             // 힘이 미치는 반경(월드 단위) — 이 밖에서는 힘이 0
      falloffMode:'linear', // linear(중심~반경 선형 감쇠) | inverse(역제곱 감쇠, 중심 근처일수록 급격히 강해짐)
      minDistance:0.2,      // 소프트닝 길이 ε(Plummer softening): 중심 특이점을 제거하고 힘이 중심에서 0으로 연속 수렴하게 함
      drag:2,               // 점성 감쇠 c(1/s): F_drag = −c·w(r)·v. vel 입력을 연결해야 작동. 임계감쇠 c≈2ω면 진동 없이 중심에 정착
      // pulse*: strength를 시간에 따라 sin파로 맥동시키는 옵션 — Vortex Field와 동일 패턴.
      // 심장박동처럼 커졌다 작아지는 인력(자석 이펙트), 주기적으로 튕겨나가는 척력 등에 사용.
      pulseEnabled:false,
      pulseFreq:1,
      pulseAmount:0.5,
      pulseTimeSource:'emitter_age',
    },
  },
  // directionalfield: 좌표와 무관하게 항상 일정한 방향으로 미는 힘. Unreal Niagara의 "Gravity
  // Force"(아래 방향 고정) / "Wind Force"(임의 방향+난류)의 단순화 버전 — 중력, 바람, 컨베이어형
  // 흐름처럼 "장소에 상관없이 늘 같은 방향으로" 작용하는 힘을 표현할 때 쓴다. 세기(strength)만
  // 다른 노드(Curve/Formula 등)에 연결하면 시간에 따라 바람 세기가 변하는 연출도 가능하다.
  directionalfield:{
    label:'Directional Force', color:'var(--node-force)',
    outputs:[{k:'fx', label:'force.x'}, {k:'fy', label:'force.y'}, {k:'fz', label:'force.z'}],
    inputs:[{k:'strength', label:'strength'}],
    defaults:{
      dirX:0, dirY:-1, dirZ:0,  // 힘의 방향(정규화되지 않아도 내부에서 정규화) — 기본값은 중력처럼 -Y
      strength:1,               // 힘 세기(스칼라 배수). strength 입력 소켓 연결 시 그 값으로 대체
      // gust*: strength가 시간에 따라 sin파로 변조되는 돌풍 옵션. Unity "Wind Zone"의
      // Turbulence/Pulse Magnitude 필드, Unreal Niagara "Wind Force"에 Curve로 세기를
      // 흔드는 흔한 패턴과 동일한 역할을 전용 필드로 제공.
      gustEnabled:false,
      gustFreq:1,
      gustAmount:0.5,
      gustTimeSource:'emitter_age',
    },
  },
  // windzone: directionalfield(일정 방향 힘)에 "영향 범위" 개념을 더한 노드. Unity의
  // "Wind Zone" 컴포넌트, Unreal Niagara의 "Wind Force"(볼륨 제한 버전)와 동일한 개념 —
  // 무한한 공간 전체에 바람을 걸지 않고, 지정한 중심(cx,cy,cz) 주변의 박스 또는 구 영역
  // 안에서만 바람이 불고 경계에서 falloff로 부드럽게 약해지도록 만든다. 방 안이나 특정
  // 구역에서만 바람이 부는 연출(창문 틈새 바람, 국소적 돌풍, 특정 구역의 깃발만 날림)에 쓴다.
  // shape='box'면 각 축(halfX/Y/Z)별 반너비를 넘는 순간 즉시 영향 밖(급격한 경계),
  // shape='sphere'면 중심으로부터의 거리 기준 반경(radius)으로 판정한다(부드러운 경계에 유리).
  windzone:{
    label:'Wind Zone', color:'var(--node-force)',
    outputs:[{k:'fx', label:'force.x'}, {k:'fy', label:'force.y'}, {k:'fz', label:'force.z'}],
    inputs:[{k:'x', label:'x'}, {k:'y', label:'y'}, {k:'z', label:'z'}, {k:'strength', label:'strength (입력, 선택)'}],
    defaults:{
      cx:0, cy:0, cz:0,          // 영역 중심 좌표
      dirX:1, dirY:0, dirZ:0,    // 바람 방향(정규화되지 않아도 내부에서 정규화) — 기본값은 +X 방향
      strength:1,                // 바람 세기(스칼라 배수). strength 입력 소켓 연결 시 그 값으로 대체
      shape:'box',               // box(축별 반너비) | sphere(반경)
      halfX:3, halfY:3, halfZ:3, // shape==='box'일 때 중심 기준 각 축 반너비(월드 단위)
      radius:3,                  // shape==='sphere'일 때 영향 반경(월드 단위)
      falloff:1,                 // 경계 감쇠 강도(0=경계까지 감쇠 없이 일정, 1=선형 감쇠, 2=더 급격한 감쇠)
      turbulence:0,              // 0보다 크면 방향 벡터에 Curl Noise를 turbulence 비율만큼 섞어 흔들리는 돌풍 느낌을 더함
      noiseScale:0.5,            // turbulence>0일 때 내부적으로 쓰는 curl noise의 scale
      // gust*: strength가 시간에 따라 sin파로 커졌다 약해지는 돌풍 옵션(directionalfield와 동일
      // 패턴). turbulence(공간적 방향 흔들림)와는 독립적으로 세기 자체가 시간에 따라 변함 —
      // 둘을 같이 켜면 "방향도 흔들리고 세기도 오르내리는" 자연스러운 돌풍이 된다.
      gustEnabled:false,
      gustFreq:1,
      gustAmount:0.5,
      gustTimeSource:'emitter_age',
    },
  },
  // wall: 위치(x,y,z)를 받아 "벽(축 정렬 박스)에 부딪힌 뒤의 위치"(x,y,z)를 돌려주는 노드.
  // 이 파이프라인은 위치를 particle_motion_parametric 수식으로 직접 계산(무상태)하므로 속도/이전
  // 프레임 값을 알 수 없다. 그래서 충돌을 "침투 보정"으로 근사한다:
  //   - 위치가 벽 박스 안이면 가장 가까운 면을 찾아 그 면 바깥으로 밀어낸다(침투깊이 m).
  //   - 반동(bounce, e): 바깥으로 e*m 만큼 되튕김. 0=면에 달라붙음, 1=완전 반사(슬라임 블록).
  //   - 마찰력(friction, μ): 접촉 깊이에 비례해 면과 평행한 방향 이동량(이미터 원점 기준)을 감쇠.
  // 여러 벽은 이름순(wall_1, wall_2, ...)으로 차례로 적용된다. 벽 이름은 모든 Wall 노드에 걸쳐
  // 중복되지 않게 자동 부여된다(wallEnsure).
  wall:{
    label:'Wall', color:'var(--node-wall)',
    outputs:[{k:'x', label:'x'}, {k:'y', label:'y'}, {k:'z', label:'z'}],
    inputs:[{k:'x', label:'x'}, {k:'y', label:'y'}, {k:'z', label:'z'}],
    defaults:{ wallCount:1, wallDetail:false, showPreview:true, walls:[], collisionMode:'auto' },
  },
  // dragfield: Bedrock 엔진 내장 linear_drag_coefficient에 직접 매핑되는 노드(v5).
  // 공식 스펙: acceleration += -linear_drag_coefficient*velocity, velocity(현재 방향×속력)는
  // Bedrock이 매 프레임 자체적으로 추적하는 실제 값이라 이 파이프라인이 별도로 "현재 속도"를
  // 계산/저장할 필요가 없다(v4에서는 그게 불가능해 vx/vy/vz를 직접 입력받아야 했지만, v5는
  // linear_acceleration 전환과 함께 Bedrock 내장 필드를 그대로 쓰도록 단순화됨).
  // 출력 coeff를 Output.motion.linear_drag_coefficient 소켓에 연결해서 쓴다.
  dragfield:{
    label:'Drag / Damping', color:'var(--node-force)',
    outputs:[{k:'coeff', label:'drag coefficient'}],
    inputs:[{k:'coeff', label:'coeff (입력, 선택)'}],
    defaults:{
      dragCoeff:0.5,   // 감쇠 계수(0=감쇠 없음, 값이 클수록 더 강하게 감속 — 보통 0.1~2 사이 값 권장)
    },
  },
  // buoyancyfield: 온도차 기반 부력(浮力) 힘. 실제 Pyro/Gas 시뮬레이션(Houdini Pyro 등)에서
  // 뜨거운 연기/불이 위로 뜨는 핵심 원리 — F ∝ (T - T_ambient), 온도가 주변보다 높을수록
  // 위쪽(또는 지정한 방향)으로 힘이 커진다. 이 에디터는 실제 온도 필드(voxel grid)가 없으므로
  // "온도"를 입력 소켓(0~1 등, Curve/Noise 등에서 끌어올 수 있음) 또는 이미터 나이 기반 값으로
  // 대체한다.
  // v5: rate_instant + 실제 수명 구조로 전환되면서 v.particle_age가 "이 파티클이 태어난 지
  // 얼마나 됐는지"를 의미하는 유효한 값이 되었다(max_lifetime의 id 인코딩과는 별개 — id
  // 시스템은 그대로 유지됨). 따라서 temperature 입력이 없을 때의 자동 시간축은 timeSource
  // 필드로 emitter_age(이미터 전체가 켜진 뒤 식어가는 전역 시간)와 particle_age(개별 파티클이
  // 태어난 뒤 각자 식어가는 시간) 중 선택할 수 있다 — 전자는 "이펙트 전체가 emitterDuration
  // 동안 뜨거웠다가 식는" 연출, 후자는 "파티클 하나하나가 각자 태어난 시점부터 식는" 연출.
  buoyancyfield:{
    label:'Buoyancy', color:'var(--node-force)',
    outputs:[{k:'fx', label:'force.x'}, {k:'fy', label:'force.y'}, {k:'fz', label:'force.z'}],
    inputs:[{k:'temperature', label:'temperature (입력, 선택 · 미연결시 emitter_age 기반 자동)'}, {k:'strength', label:'strength (입력, 선택)'}],
    defaults:{
      dirX:0, dirY:1, dirZ:0,      // 부력 방향(정규화되어 사용) — 기본은 위쪽(+Y)
      ambient:0,                    // 주변 온도(T_ambient) — temperature 입력값이 이보다 낮으면 힘이 반대(가라앉음)로 뒤집힘
      strength:1,                   // 힘 세기 배수. strength 입력 소켓 연결 시 그 값으로 대체
      useEmitterAge:true,           // temperature 미연결시: 아래 timeSource 기반으로 자동 온도를 생성할지 여부
      timeSource:'emitter_age',     // 자동 시간축 선택: 'emitter_age'(이미터 전역 경과시간) | 'particle_age'(개별 파티클 생존시간, v5부터 유효)
      emitterDuration:2,            // useEmitterAge일 때: 이 시간(초) 동안 온도 1→0으로 식음(그 이후는 floor인 0 유지)
      cooldownCurve:2,              // 식는 곡선 지수(1=선형, 값이 클수록 초반에 급격히 식고 이후 완만)
    },
  },
  // dissipationfield: 밀도/온도/연료(fuel) 같은 필드가 시간이 지나면서 사라지는(exponential decay)
  // 현상을 표현하는 스칼라 노드. 문서에서 D_(t+1) = D_t * (1-α·Δt) 형태로 설명한 dissipation을
  // Bedrock Molang의 이미터 경과 시간 기준 지수 감쇠로 근사한다 — Unity VFX Graph에는 전용
  // Dissipation 블록이 없어 보통 Curve로 흉내내지만, 여기서는 half-life(반감기) 개념으로 직접
  // 입력하면 감쇠 곡선을 계산해주는 전용 유틸리티. 연기가 옅어지거나(alpha), 온도가 식어
  // 색이 어두워지거나(gradient의 t), 크기가 줄어드는 등 "천천히 사라지는" 모든 값에 재사용 가능.
  // v5: Buoyancy와 동일하게, in 입력이 없을 때의 자동 시간축은 timeSource 필드로 emitter_age
  // (t=0 기준 "이 이미터가 처음 켜진 시점")와 particle_age(t=0 기준 "이 파티클이 태어난 시점",
  // v5부터 유효한 값) 중 선택할 수 있다.
  dissipationfield:{
    label:'Dissipation', color:'var(--node-remap)',
    outputs:[{k:'out', label:'out (0~start)'}],
    inputs:[{k:'in', label:'t (0~1, 입력 · 미연결시 emitter_age 기반 자동)'}, {k:'rate', label:'rate (입력, 선택)'}],
    defaults:{
      start:1,                       // t=0(이미터 시작 시점)에서의 시작값(예: 초기 밀도/알파)
      halfLife:0.35,                 // 반감기(半減期) — 이 시간(0~1 정규화 축 기준 비율)이 지날 때마다 값이 절반으로 줄어듦. rate 입력이 연결되면 무시.
      floor:0,                       // 완전히 사라진 뒤 남는 바닥값(0=완전히 소멸, >0이면 옅은 잔여값 유지)
      useEmitterAge:true,            // in 미연결시 아래 timeSource 기반으로 자동 시간축 생성할지 여부
      timeSource:'emitter_age',      // 자동 시간축 선택: 'emitter_age'(이미터 전역 경과시간) | 'particle_age'(개별 파티클 생존시간, v5부터 유효)
      emitterDuration:2, emitterMode:'once', // useEmitterAge일 때: 이 시간(초) 동안 0→1로 진행. once=1회(끝값 유지) | loop=반복
    },
  },
  // accumulate [v8-5: 상태 없는(stateless) 노드로 개조]. v.* 상태변수를 프레임 간 저장하지 않고 매 프레임 id·시간에서 처음부터 다시 계산한다.
  // (구 설명) accumulate: 상태저장(stateful) 노드. Bedrock Molang의 v.* 변수는 파티클별로 프레임 간 유지되므로
  // 상태 변수 v.ac<ctx><id>s 에 매 프레임 in*Δt 를 더해 누적한다. Δt는 query.delta_time이 없으므로
  // v.particle_age - (직전에 저장해 둔 v.particle_age)로 계산한다 — 한 프레임에 여러 식이 같은 라인을
  // 재평가해도 2번째부터는 Δt=0이라 중복 누적되지 않는다. off(스폰 시 1회) 컨텍스트에서는 init만 출력.
  // [v8-2-5] constant: 상수값 하나를 출력하는 노드. Accumulate의 in/init, Formula, Output 등
  // 어떤 숫자 입력에도 연결할 수 있다(별도 계산 없이 값 그대로 — 모든 컨텍스트에서 동일).
  constant:{
    label:'Constant', color:'var(--node-math)',
    outputs:[{k:'out', label:'out (상수)'}],
    inputs:[],
    defaults:{ value:1, previewValue:1 },
  },
  accumulate:{
    label:'Accumulate', color:'var(--node-remap)',
    outputs:[{k:'out', label:'out (init + ∫in dt)'}],
    inputs:[{k:'in', label:'in (초당 증가량 · 미연결시 rate 필드)'}, {k:'reset', label:'reset (0/1 · 선택)'}, {k:'init', label:'init (초기값 · 미연결시 init 필드)'}],
    defaults:{
      rate:1,          // in 미연결시 초당 증가량 (닫힌 형태 rate*T로 정확히 계산)
      init:0,          // 초기값(출력 = init + 적분값)
      mode:'integrate',// integrate: in×dt | perframe: in을 60fps 프레임 단위로 환산(in×60×dt)
      limitMode:'none',// none | clamp | wrap
      min:0, max:1,
      damping:0,       // [물리] 점성 감쇠 c(1/s): 상태가 ẋ = in − c·x 를 따른다(속도 노드에 쓰면 선형 항력 −c·v). 0=감쇠 없음(기존 동일)
      samples:8,       // [v8-5] in/reset 연결 시 구간 분할 수 N (중점 리만합, 1~32). 식 길이가 N배
      timeSource:'particle_age', // [v8-5] 적분 상한 T: particle_age | emitter_age
      stepDist:'auto', // [v10.5] 적분 구간 분할: auto(벽 루프면 grid, 아니면 end) | grid(고정 시간 격자) | end(끝 쪽 스텝을 잘게) | uniform(균등)
    },
  },
  // remap: 입력값을 [inMin,inMax] 구간에서 [outMin,outMax] 구간으로 선형 재매핑한다.
  // Unity Shader Graph/VFX Graph의 "Remap", Houdini의 "Fit" 노드와 동일한 표준 유틸리티 —
  // 노이즈(-1~1)를 0~1로 바꾸거나, 벡터장 힘의 세기 범위를 다른 스케일로 옮길 때 자주 쓰인다.
  remap:{
    label:'Remap', color:'var(--node-remap)',
    outputs:[{k:'out', label:'out'}],
    inputs:[{k:'in', label:'in'}],
    defaults:{ inMin:-1, inMax:1, outMin:0, outMax:1, clampOut:true },
  },
  // vecfield_image: 업로드한 이미지를 저해상도 그리드로 "구워서(bake)" 만드는 커스텀 벡터장.
  // Bedrock Molang은 텍스처 샘플링이 없으므로, 그리드 각 셀의 힘(fx,fy)을 미리 계산해두고
  // export 시 좌표를 그리드 인덱스로 변환한 뒤 math.clamp+분기 체인(룩업 테이블 근사)으로
  // 내보낸다. Unity VFX Graph의 Flow Map/Vector Field Texture, Houdini의 baked velocity
  // volume과 같은 개념을 브라우저에서 이미지로 근사한 버전.
  vecfield_image:{
    label:'Vector Field (Image)', color:'var(--node-curl)',
    outputs:[{k:'fx', label:'force.x'}, {k:'fy', label:'force.y'}],
    inputs:[{k:'x', label:'x'}, {k:'y', label:'y'}],
    defaults:{
      resolution:16,          // 그리드 한 변 셀 개수(직접 입력, 베이킹 정밀도용 — export 방식과는 별개)
      mode:'gradient',        // gradient(밝기 그래디언트) | contour(마스크 경계 흐름) | flowmap(RGB 채널 직접 방향)
      amplitude:1,
      areaSize:4,             // 이 벡터장이 매핑되는 월드 공간 한 변 크기(그리드 밖은 가장 가까운 셀 값으로 clamp)
      previewDensity:14,
      imageDataUrl:null,      // base64 인코딩된 원본 이미지(저장/불러오기 시 함께 보존)
      bakedGrid:null,         // [[fx,fy],...] resolution*resolution 길이의 베이크 결과(정규화된 -1~1 힘)
      imageName:'',
      // exportMode: 'lookup'(삼항 체인 — 정확하지만 셀 수만큼 조건문. 소해상도/소량에만 안전)
      //           | 'fourier'(2D 저주파 sin/cos 근사 — 조건문 0개, 정확도는 낮지만 길이가 항 개수로 고정됨).
      exportMode:'fourier',
      fourierTerms:8,         // 저주파 항 개수(항마다 sin+cos 한 쌍 = Molang 호출 2개). 값이 클수록 정확하지만 길어짐.
      lookupMaxTernaries:20,  // lookup 모드일 때 허용할 삼항 개수 상한(셀 수 초과 시 자동으로 fourier로 강등)
      fourierCoeffs:null,     // 베이크 시 함께 계산해두는 피팅 결과: {fx:[{m,n,a,b},...], fy:[...]}
    },
  },
  // math(Formula): 자유 수식 노드. v5부터 t(시간) 입력 소켓이 추가되어, Unity VFX Graph의
  // "Time" Operator / Unreal Niagara의 "Engine Time" 모듈과 동일하게 어느 수식에서든 시간을
  // 자유변수로 쓸 수 있다 — 예: expr='1+sin(t*2)'를 Vortex/Attractor 등의 strength 입력에
  // 연결하면 세기가 시간에 따라 맥동한다. t 입력 소켓이 미연결이면 timeSource 필드로 선택한
  // emitter_age(이미터 전역 경과시간, v.emitter_age) 또는 particle_age(개별 파티클 생존시간,
  // v.particle_age · v5부터 유효)를 자동으로 흘려보낸다.
  math:{
    label:'Formula', color:'var(--node-math)',
    outputs:[{k:'out', label:'out'}],
    inputs:[{k:'a', label:'a'}, {k:'b', label:'b'}, {k:'c', label:'c'}, {k:'d', label:'d'}, {k:'t', label:'t (시간, 입력 · 미연결시 자동)'}],
    defaults:{ expr:'a+b', timeSource:'emitter_age' },
  },
  // gradient: 여러 색상 정지점(stop) 사이를 t(0~1)로 선형보간하는 컬러 램프.
  // Unity Shader Graph/VFX Graph의 Gradient 노드, Houdini의 Color Ramp, Bedrock의
  // particle_appearance_tinting.color.gradient와 동일한 개념 — 여기서는 t 입력(보통 파티클
  // 수명 0~1 또는 노이즈값)에 따라 r/g/b를 각각 뽑아 Output.tint에 바로 연결해 쓴다.
  gradient:{
    label:'Color Gradient', color:'var(--node-gradient)',
    outputs:[{k:'r', label:'r'}, {k:'g', label:'g'}, {k:'b', label:'b'}],
    inputs:[{k:'t', label:'t (0~1)'}],
    defaults:{ stops:[ {pos:0, color:'#ff9d4d'}, {pos:0.5, color:'#ff3d7a'}, {pos:1, color:'#3d1aff'} ] },
  },
  // curve: 0~1 구간의 커스텀 곡선(포인트를 손가락으로 찍고 드래그해 편집) — Unity Particle
  // System의 "Curve over Lifetime", VFX Graph의 AnimationCurve 개념과 동일. t 입력(보통
  // 0~1 진행도)을 받아 그 곡선값을 out으로 낸다. 크기/알파를 시간에 따라 자연스럽게
  // 커졌다 작아지게 하는 용도로 흔히 쓰인다.
  // v5: t 미연결시 자동 시간축은 timeSource 필드로 emitter_age(이펙트 전체가 공유하는 진행도)와
  // particle_age(파티클마다 각자 태어난 시점부터의 진행도, v5부터 유효한 값) 중 선택할 수 있다.
  // (max_lifetime의 id 인코딩은 그대로 유지되며 이 시간축 선택과는 무관하다.)
  curve:{
    label:'Curve (Over-Life)', color:'var(--node-curve)',
    outputs:[{k:'out', label:'out'}],
    inputs:[{k:'t', label:'t (0~1)'}],
    defaults:{ points:[ {x:0,y:0.2}, {x:0.5,y:1}, {x:1,y:0} ], useEmitterAge:true, timeSource:'emitter_age', emitterDuration:1, emitterMode:'loop' },
  },
  // flipbook: 텍스처 아틀라스(그리드로 나눠진 여러 프레임)를 시간에 따라 순서대로 재생하는
  // UV 노드. Unity Particle System의 "Texture Sheet Animation" 모듈, Unreal Niagara의
  // "Sub UV Animation"과 동일한 개념. columns×rows 그리드에서 startFrame부터 frameCount개
  // 프레임을 fps 속도로 순환(loop) 또는 1회 재생(once)하며, 현재 프레임의 uv.u/uv.v(좌상단
  // 텍셀 좌표)와 uv_size.w/uv_size.h(프레임 한 칸의 텍셀 크기)를 출력한다. Output 노드의
  // uv.u / uv.v / uv_size.w / uv_size.h 소켓에 그대로 연결해서 쓴다. t 입력을 연결하면(0~1)
  // 그 값으로 프레임을 고르고, 미연결이면 timeSource 필드로 선택한 emitter_age(이미터 전역
  // 경과시간) 또는 particle_age(개별 파티클 생존시간, v5부터 유효) 기준 fps 재생으로 자동 진행한다.
  flipbook:{
    label:'Flipbook UV', color:'var(--node-curve)',
    outputs:[{k:'u', label:'uv.u'}, {k:'v', label:'uv.v'}, {k:'uw', label:'uv_size.w'}, {k:'uh', label:'uv_size.h'}],
    inputs:[{k:'t', label:'t (0~1, 미연결시 자동)'}],
    defaults:{
      columns:4, rows:4,          // 아틀라스 그리드(가로×세로 칸 수)
      frameWidth:16, frameHeight:16, // 칸 하나의 텍셀 크기(=emitter texture_width/height와 별개로 지정 가능)
      startFrame:0, frameCount:16,   // 재생 시작 프레임(0-index) · 재생할 총 프레임 수
      fps:24,                        // 초당 프레임 수 — 아래 timeSource 기준으로 진행
      timeSource:'emitter_age',      // 자동 시간축 선택: 'emitter_age'(이미터 전역 경과시간) | 'particle_age'(개별 파티클 생존시간, v5부터 유효)
      loopMode:'loop',               // loop(반복) | once(마지막 프레임에서 정지) | pingpong(왕복)
    },
  },
  // threshold: 입력값(주로 Noise 3D 출력, -1~1 또는 0~1)을 기준값(threshold)과 비교해
  // 0 또는 1로 이진화하는 노드 — Unity Shader Graph의 "Step"/"Threshold" 노드, dissolve
  // 셰이더에서 흔히 쓰는 개념과 동일. softness>0이면 경계 근처를 부드럽게 보간(smoothstep)해서
  // 딱딱한 계단 대신 자연스러운 dissolve 가장자리를 만든다. invert로 안팎을 뒤집을 수 있다.
  // 출력을 Output.tint.a(alpha)에 연결하면, 파티클 수명(t)에 따라 threshold를 오르내리게
  // 만들어(threshold 입력에 Curve를 연결) 노이즈 패턴을 따라 점점 사라지는 dissolve 효과를 만들 수 있다.
  threshold:{
    label:'Threshold / Dissolve', color:'var(--node-remap)',
    outputs:[{k:'out', label:'out (0~1)'}],
    inputs:[{k:'in', label:'in'}, {k:'edge', label:'threshold (입력, 선택)'}],
    defaults:{ threshold:0.5, softness:0.05, invert:false },
  },
  output:{
    label:'Output', color:'var(--node-output)',
    outputs:[],
    inputs:[
      // offset(위치)은 v4의 그래프를 그대로 유지한다.
      // v5에서는 이 소켓이 별도의 '가속도 제어' 소켓으로 분리되지 않는다.
      // 컴파일러가 이 offset 그래프 자체를 매 프레임 다시 평가해 2차 차분하고,
      // 그 결과를 Bedrock의 linear_acceleration에 내부적으로 연결한다.
      {k:'offx', label:'offset.x', timing:'once'}, {k:'offy', label:'offset.y', timing:'once'}, {k:'offz', label:'offset.z', timing:'once'},
      // size/tint(r/g/b/a): 기존처럼 매 프레임 재계산하는 표현값.
      {k:'r', label:'tint.r', timing:'perframe'}, {k:'g', label:'tint.g', timing:'perframe'},
      {k:'b', label:'tint.b', timing:'perframe'}, {k:'a', label:'tint.a', timing:'perframe'},
      {k:'size_x', label:'size.x', timing:'perframe'}, {k:'size_y', label:'size.y', timing:'perframe'},
      // UV: billboard.uv.uv / uv.uv_size — Bedrock 스펙상 매 프레임 평가되는 Molang 수식
      // 배열이라 완전히 수식화 가능. 미연결시 (0,0)/(texture_width,texture_height)로 폴백
      // (=텍스처 전체를 그대로 사용, 기존 동작과 동일).
      {k:'uvx', label:'uv.u', timing:'perframe'}, {k:'uvy', label:'uv.v', timing:'perframe'},
      {k:'uvw', label:'uv_size.w', timing:'perframe'}, {k:'uvh', label:'uv_size.h', timing:'perframe'},
      // direction: particle_motion_parametric.direction — lookat_direction / direction_x/y/z 모드가 읽는
      // 파티클 방향 벡터. offset과 같은 motion 컨텍스트에서 매 프레임 평가된다(timing:'motion').
      // rotation: [v1.1.3] particle_motion_parametric.rotation(문서: 매 프레임 평가, 파티클 회전을 직접 지정)으로 내보낸다.
      // 예전엔 particle_initial_spin.rotation(생성 때 1회 평가)이라 시간에 따라 바뀌는 값을 연결해도 돌지 않았다.
      {k:'rot', label:'rotation (도° · 매 프레임)', timing:'perframe'},
      // life: 파티클 라이프타임(초). 매 프레임 v.particle_age >= life 이면 expiration_expression으로 킬한다.
      // (max_lifetime은 id 인코딩에 쓰이므로 건드리지 않음 — Bedrock 문서의 expiration_expression 방식)
      {k:'life', label:'particle_lifetime (age≥값이면 kill)', timing:'perframe'},
      {k:'dirx', label:'direction.x', timing:'motion'}, {k:'diry', label:'direction.y', timing:'motion'}, {k:'dirz', label:'direction.z', timing:'motion'},
    ],
    defaults:{},
  },
};

// (ed_hint_encodeId 제거됨: 완전 분산형 파이프라인은 항상 max_lifetime에 id를 인코딩)

// ---- Wall 노드 보조 함수: 벽 이름은 모든 Wall 노드에 걸쳐 중복되지 않아야 한다 ----
function wallEnsure(node){
  const d = node.data;
  if(!Array.isArray(d.walls)) d.walls = [];
  let cnt = Math.round(Number(d.wallCount));
  if(!isFinite(cnt) || cnt<1) cnt = 1;
  if(cnt>32) cnt = 32;
  d.wallCount = cnt;
  const used = new Set();
  Object.values(state.nodes).forEach(n=>{
    if(n!==node && n.type==='wall' && n.data && Array.isArray(n.data.walls)) n.data.walls.forEach(w=>{ if(w&&w.name) used.add(w.name); });
  });
  const own = new Set();
  d.walls.forEach(w=>{ if(!w.name || used.has(w.name) || own.has(w.name)) w.name = null; else own.add(w.name); });
  const nextName = ()=>{ let n=1; while(used.has('wall_'+n) || own.has('wall_'+n)) n++; const nm='wall_'+n; own.add(nm); return nm; };
  d.walls.forEach(w=>{ if(!w.name) w.name = nextName(); });
  while(d.walls.length>cnt) d.walls.pop();
  while(d.walls.length<cnt){
    const k = d.walls.length;
    d.walls.push({ name:nextName(), minX:2+k*2, minY:-3, minZ:-3, maxX:3+k*2, maxY:3, maxZ:3, friction:0.2, bounce:0.8 });
  }
}

function createNode(type, x, y){
  const id = uid(type);
  const def = NODE_DEFS[type];
  const node = {
    id, type, x, y,
    data: JSON.parse(JSON.stringify(def.defaults)),
  };
  state.nodes[id] = node;
  if(type==='wall') wallEnsure(node);
  return node;
}

function createWire(fromNode, fromSocket, toNode, toSocket){
  // 입력 소켓 하나엔 하나의 연결만 허용 → 기존 연결 제거
  for(const wid in state.wires){
    const w = state.wires[wid];
    if(w.to.node===toNode && w.to.socket===toSocket){ delete state.wires[wid]; }
  }
  const id = uid('wire');
  state.wires[id] = { from:{node:fromNode, socket:fromSocket}, to:{node:toNode, socket:toSocket} };
  return id;
}

// [v10.9] 자세히 설정으로 입력을 받을 수 있는 숫자 칸(게임 실행 중 계산되는 값만). 식의 구조를 정하는 값(개수·옥타브·samples·
// 텍스처 크기·falloff 지수·축 방향 등)은 값에 따라 식 모양 자체가 달라져서 연결할 수 없다.
const DETAIL_INPUTS = {
  vortexfield:['cx','cy','cz','inwardPull','core','drag','pulseFreq','pulseAmount'],
  attractorfield:['cx','cy','cz','minDistance','pulseFreq','pulseAmount'],
  directionalfield:['dirX','dirY','dirZ','gustFreq','gustAmount'],
  windzone:['cx','cy','cz','dirX','dirY','dirZ','radius','halfX','halfY','halfZ','noiseScale','gustFreq','gustAmount'],
  remap:['inMin','inMax','outMin','outMax'],
  accumulate:['rate'],
  noise3d:['rotateStep','tiltX','tiltY','cycleOffsetStepX','cycleOffsetStepY','cycleOffsetStepZ'],
};
// 그래프 탐색용 입력 목록(기본 소켓 + 자세히 설정 소켓)
// [v1.1] 벽 노드는 벽 개수에 따라 칸이 달라서 노드마다 따로 만든다(키: "w번호:칸").
const WALL_DK = ['minX','minY','minZ','maxX','maxY','maxZ','friction','bounce','reboundLimit'];
function detailKeysOf(node){
  if(node && node.type==='wall') return ((node.data&&node.data.walls)||[]).flatMap((w,i)=>WALL_DK.map(k=>`w${i}:${k}`));
  return DETAIL_INPUTS[node && node.type]||[];
}
function nodeAllInputs(type, node){ if(type==='wall' && node) return [...NODE_DEFS.wall.inputs, ...detailKeysOf(node).map(k=>({k, label:k, detail:true}))];
  const d=NODE_DEFS[type]; if(!d) return []; if(!d._allIn){ d._allIn=[...(d.inputs||[]), ...(DETAIL_INPUTS[type]||[]).map(k=>({k, label:k, detail:true}))]; } return d._allIn; }
// 자세히 설정 값: 연결돼 있으면 "(식)", 아니면 원래 숫자
function PV(node, key, fb, ctx){ return findWireInto(node.id,key) ? `(${resolveInput(node.id,key,String(fb),ctx)})` : fb; }

/* -------------------------------------------------------------------------
   4.5 노드 내장 미리보기(Noise / Curl Noise / Gradient / Curve)
   여기서 계산하는 JS 함수들은 실제로 export되는 Molang 노이즈(perlinNoiseMolang 등)와
   "같은 알고리즘을 손으로 재현"한 것이다 — 브라우저에는 v.emitter_age 같은 게임 컨텍스트가
   없으므로 완전히 동일한 값이 나올 필요는 없고, "이 파라미터로는 대략 이런 패턴/색/커브가
   나온다"는 감을 즉시 눈으로 확인시켜 주는 용도다(실제 VFX 프로그램의 노드 썸네일 프리뷰와
   같은 목적 — Unity Shader Graph, Houdini 등도 마찬가지로 근사 프리뷰를 보여준다).
   ------------------------------------------------------------------------- */

// 결정론적 해시(시드 기반) — Molang 버전(perlinNoiseMolang)의 sin-hash와 동일한 트릭을 JS로 재현.
function _hash3(x,y,z,seed){
  const v = Math.sin(x*127.1+y*311.7+z*74.7+seed*19.19)*43758.5453;
  return v - Math.floor(v);
}
function _grad3(x,y,z,seed){
  const h = Math.abs(_hash3(Math.floor(x),Math.floor(y),Math.floor(z),seed));
  return [Math.cos(h*360*Math.PI/180), Math.sin(h*360*Math.PI/180), Math.cos(h*721*Math.PI/180)];
}
function _fade(t){ return t*t*t*(t*(t*6-15)+10); } // hermite/quintic smoothstep (math.hermite_blend와 동일 계열)

// Perlin(그라디언트) 노이즈 — perlinNoiseMolang과 동일한 3D 격자 보간 구조.
function perlinNoise3D(x,y,z,seed){
  const x0=Math.floor(x), y0=Math.floor(y), z0=Math.floor(z);
  const fx=x-x0, fy=y-y0, fz=z-z0;
  const sx=_fade(fx), sy=_fade(fy), sz=_fade(fz);
  function n(ox,oy,oz){
    const g = _grad3(x0+ox,y0+oy,z0+oz,seed);
    return g[0]*(fx-ox)+g[1]*(fy-oy)+g[2]*(fz-oz);
  }
  const n000=n(0,0,0), n100=n(1,0,0), n010=n(0,1,0), n110=n(1,1,0);
  const n001=n(0,0,1), n101=n(1,0,1), n011=n(0,1,1), n111=n(1,1,1);
  const a=n000+(n100-n000)*sx, b=n010+(n110-n010)*sx;
  const c=n001+(n101-n001)*sx, d=n011+(n111-n011)*sx;
  const e=a+(b-a)*sy, f=c+(d-c)*sy;
  return e+(f-e)*sz;
}

// Simplex 노이즈 근사 — 격자를 삼각/사면체 형태로 기울여 샘플링(perlin과 달리 축방향
// 아티팩트가 덜 도드라진다). 정확한 Ken Perlin 원본 구현 대신, 미리보기 목적에 맞는
// 단순화된 스큐(skew) 근사를 사용한다.
function simplexNoise3D(x,y,z,seed){
  const s=(x+y+z)/3;
  const i=Math.floor(x+s), j=Math.floor(y+s), k=Math.floor(z+s);
  const t=(i+j+k)/6;
  const X0=i-t, Y0=j-t, Z0=k-t;
  const x0=x-X0, y0=y-Y0, z0=z-Z0;
  let n=0, wsum=0;
  for(let dx=0; dx<=1; dx++) for(let dy=0; dy<=1; dy++) for(let dz=0; dz<=1; dz++){
    const gx=x0-dx, gy=y0-dy, gz=z0-dz;
    const t2 = 0.6 - gx*gx - gy*gy - gz*gz;
    if(t2>0){
      const g=_grad3(i+dx,j+dy,k+dz,seed*1.7+3);
      const t4=t2*t2*t2*t2;
      n += t4*(g[0]*gx+g[1]*gy+g[2]*gz);
      wsum += t4;
    }
  }
  return wsum>0 ? n/wsum*2.2 : 0;
}

// Voronoi/Cellular(Worley) 노이즈 — 각 셀에 무작위 씨앗점을 하나씩 두고, 가장 가까운
// 씨앗점까지의 거리를 값으로 쓴다. smooth>0이면 최소/차소 거리 차를 부드럽게 섞는다.
function voronoiNoise3D(x,y,z,seed,smooth){
  const cx=Math.floor(x), cy=Math.floor(y), cz=Math.floor(z);
  let best=1e9, second=1e9;
  for(let dx=-1; dx<=1; dx++) for(let dy=-1; dy<=1; dy++) for(let dz=-1; dz<=1; dz++){
    const gx=cx+dx, gy=cy+dy, gz=cz+dz;
    const jx=_hash3(gx,gy,gz,seed*3+1);
    const jy=_hash3(gx,gy,gz,seed*3+7);
    const jz=_hash3(gx,gy,gz,seed*3+13);
    const px=gx+jx, py=gy+jy, pz=gz+jz;
    const d = Math.sqrt((x-px)**2+(y-py)**2+(z-pz)**2);
    if(d<best){ second=best; best=d; } else if(d<second){ second=d; }
  }
  smooth = smooth||0;
  return best + (second-best)*smooth*0.5;
}

// FBM(Fractal Brownian Motion) — Perlin을 옥타브 수만큼 겹쳐 큰 형태 위에 디테일을 더한다.
function fbmNoise3D(x,y,z,seed,octaves,lacunarity,gain){
  let amp=1, freq=1, sum=0, norm=0;
  for(let o=0; o<octaves; o++){
    sum += perlinNoise3D(x*freq,y*freq,z*freq,seed+o*11)*amp;
    norm += amp;
    amp *= gain; freq *= lacunarity;
  }
  return norm>0 ? sum/norm : 0;
}

function evalNoiseNode(data, x, y, z){
  const type = data.noiseType || 'perlin';
  if(type==='simplex') return simplexNoise3D(x,y,z,data.seed||0);
  if(type==='voronoi') return voronoiNoise3D(x*(data.cellDensity||2),y*(data.cellDensity||2),z*(data.cellDensity||2),data.seed||0,data.voronoiSmooth||0)*2-1;
  if(type==='fbm') return fbmNoise3D(x,y,z,data.seed||0, Math.max(1,Math.round(data.octaves||3)), data.lacunarity||2, data.gain!==undefined?data.gain:0.5);
  return perlinNoise3D(x,y,z,data.seed||0);
}

// Curl noise: 노이즈 스칼라장의 (근사) curl을 유한차분으로 구해 발산-없는 벡터장을 만든다.
// psi를 potential로 보고 curl(psi) = (dPz/dy - dPy/dz, dPx/dz - dPz/dx, dPy/dx - dPx/dy) 형태로
// 세 개의 독립된 노이즈장을 potential 성분으로 사용하는 표준적인 방식.
function curlNoise3D(x,y,z,seed,eps){
  eps = eps||0.08;
  const p = (ox,oy,oz,s)=> perlinNoise3D(x+ox,y+oy,z+oz,seed+s);
  const dPzdy = (p(0,eps,0,20)-p(0,-eps,0,20))/(2*eps);
  const dPydz = (p(0,0,eps,10)-p(0,0,-eps,10))/(2*eps);
  const dPxdz = (p(0,0,eps,0)-p(0,0,-eps,0))/(2*eps);
  const dPzdx = (p(eps,0,0,20)-p(-eps,0,0,20))/(2*eps);
  const dPydx = (p(eps,0,0,10)-p(-eps,0,0,10))/(2*eps);
  const dPxdy = (p(0,eps,0,0)-p(0,-eps,0,0))/(2*eps);
  return [ dPzdy-dPydz, dPxdz-dPzdx, dPydx-dPxdy ];
}

// Curl Turbulence: curlNoise3D를 여러 옥타브로 겹쳐(fbmNoise3D와 동일한 가중합 방식) 만드는
// 다중 스케일 난류 벡터장. 옥타브마다 좌표 스케일은 lacunarity배, 그 옥타브의 기여도는 gain배로
// 줄여가며 합산한다 — 순수 JS 버전(미리보기와 export가 같은 공식을 공유).
function curlTurbulence3D(x,y,z,seed,octaves,lacunarity,gain){
  let amp=1, freq=1, fx=0, fy=0, fz=0, norm=0;
  for(let o=0; o<octaves; o++){
    const f = curlNoise3D(x*freq, y*freq, z*freq, seed+o*11);
    fx += f[0]*amp; fy += f[1]*amp; fz += f[2]*amp;
    norm += amp;
    amp *= gain; freq *= lacunarity;
  }
  if(norm>0){ fx/=norm; fy/=norm; fz/=norm; }
  return [fx,fy,fz];
}

// Wind Zone: directionalfield(일정 방향 힘)에 영역 제한(박스 또는 구)과 경계 falloff를 더한
// 버전. 순수 JS 버전 — 미리보기(캔버스)와 buildGraph의 Molang 컴파일이 같은 공식을 공유한다.
function windZoneForce(x,y,z, data, overrides){
  overrides = overrides || {};
  const cx=data.cx||0, cy=data.cy||0, cz=data.cz||0;
  const dx=x-cx, dy=y-cy, dz=z-cz;
  let atten;
  if(data.shape==='sphere'){
    const radius = Math.max(0.01, data.radius!==undefined?data.radius:3);
    const dist = Math.sqrt(dx*dx+dy*dy+dz*dz);
    if(dist>radius) return [0,0,0];
    atten = 1 - dist/radius;
  } else {
    const hx=Math.max(0.01,data.halfX!==undefined?data.halfX:3), hy=Math.max(0.01,data.halfY!==undefined?data.halfY:3), hz=Math.max(0.01,data.halfZ!==undefined?data.halfZ:3);
    if(Math.abs(dx)>hx || Math.abs(dy)>hy || Math.abs(dz)>hz) return [0,0,0];
    // 각 축별로 경계까지 남은 비율 중 가장 작은 값(가장 가까운 벽)을 기준으로 감쇠
    const tx=1-Math.abs(dx)/hx, ty=1-Math.abs(dy)/hy, tz=1-Math.abs(dz)/hz;
    atten = Math.min(tx,ty,tz);
  }
  const falloff = data.falloff!==undefined?data.falloff:1;
  atten = falloff<=0 ? 1 : Math.pow(Math.max(0,atten), falloff);
  let ddx=data.dirX!==undefined?data.dirX:1, ddy=data.dirY!==undefined?data.dirY:0, ddz=data.dirZ!==undefined?data.dirZ:0;
  const dlen = Math.sqrt(ddx*ddx+ddy*ddy+ddz*ddz)||1;
  ddx/=dlen; ddy/=dlen; ddz/=dlen;
  const turbulence = data.turbulence||0;
  if(turbulence>0){
    const noiseScale = data.noiseScale!==undefined?data.noiseScale:0.5;
    const c = curlNoise3D(x*noiseScale, y*noiseScale, z*noiseScale, (data.seed||0));
    ddx = ddx*(1-turbulence) + c[0]*turbulence;
    ddy = ddy*(1-turbulence) + c[1]*turbulence;
    ddz = ddz*(1-turbulence) + c[2]*turbulence;
  }
  const strength = (overrides.strength!==undefined?overrides.strength:(data.strength!==undefined?data.strength:1)) * atten;
  return [ddx*strength, ddy*strength, ddz*strength];
}

// ===================================================================================
// [v9 물리 수정] 힘 노드(Attractor/Vortex) ↔ Accumulate(적분기) 결합
// -----------------------------------------------------------------------------------
// 진짜 원인(실측: 노이즈·벽·와류를 모두 꺼도 입자가 중심에 모였다가 다시 날아감):
//  Accumulate는 전체 수명 T를 고정 N(≤32)조각으로 나눠 "전진 오일러"로 적분한다. 스텝 h=T/N은 수명 15초·N=8이면
//  최대 1.9초다. 인력 중심 근처의 복원 강성 λ=s/ε(=10/s)에서 오일러 증폭률은 |1−hλ|인데, hλ>2이면 한 스텝마다
//  진동 진폭이 커져(발산) 입자가 오히려 바깥으로 튕겨 나간다 → "중력점에 안 모이고 퍼진다".
//  회전(와류)도 마찬가지로 오일러 한 스텝마다 반지름이 √(1+(Ωh)²)배로 늘어 바깥으로 나선을 그린다.
// 해결: 임시 제한(clamp) 대신 적분 공식을 바꾼다.
//  · 1계(힘→위치 직결) : 지수 오일러  x⁺ = x + h·φ(hΛ)·f ,  φ(z)=(1−e^−z)/z   (선형 복원력에 대해 정확, 어떤 h에서도 안정,
//                         f=0인 평형점을 그대로 보존)
//  · 2계(힘→속도→위치) : 선형 음해법  v⁺ = v + h·f/(1+h·c+h²·Λ)  (심플렉틱 오일러에 강성·감쇠를 음해적으로 반영)
//  · 와류(1계)         : 스텝 동안의 선형 흐름의 정확해 r⁺ = e^(−κh)·R(Ωh)·r  (반지름이 스텝 크기와 무관하게 정확)
// Λ(강성)은 각 힘 노드가 자기 위치 미분에서 계산해 내보낸다(attractor: s·w·g).
// ===================================================================================

// 필드 노드의 출력이 어떤 Accumulate의 in/reset에 들어가는지(= 이 힘을 적분하는 노드들)
function _downAccs(startId){
  const out = new Set(), seen = new Set([startId]), q = [startId], wires = Object.values(state.wires);
  while(q.length){
    const id = q.shift();
    wires.forEach(w=>{
      if(w.from.node!==id) return;
      const to = state.nodes[w.to.node]; if(!to) return;
      if(to.type==='accumulate'){ if(w.to.socket==='in'||w.to.socket==='reset') out.add(to.id); return; }
      if(!seen.has(to.id)){ seen.add(to.id); q.push(to.id); }
    });
  }
  return [...out];
}
// 속도 단계(힘→속도, 속도→위치로 한 번 더 적분되는 Accumulate)인가?
function accIsVelocityLike(id){
  const grp = accFeedbackGroup(id).filter(g=>state.nodes[g]);
  if(grp.length>1){
    const hop = g=>{ const v=accReadHops(g,grp); return Number.isFinite(v)?v:1e9; };
    return hop(id) > Math.min(...grp.map(hop));
  }
  return _downAccs(id).some(b=>b!==id);
}
// 필드가 적분되는 차수: 1 = 힘을 곧바로 위치에 적분(속도장으로 해석), 2 = 힘→속도→위치(가속도로 해석)
function fieldIntegrationOrder(fid){
  const accs = _downAccs(fid);
  if(!accs.length) return 2;                       // 적분기에 안 연결 → 기존대로 "힘(가속도)"
  return accs.some(a=>accIsVelocityLike(a)) ? 2 : 1;
}
// 이 Accumulate의 in/reset 상류에 있고, 위치 입력이 같은 그룹의 상태에 의존(피드백)하는 Attractor/Vortex 목록
function accStiffFields(accId, grp){
  const res = [], seen = new Set(), q = [];
  ['in','reset'].forEach(k=>{ const w=findWireInto(accId,k); if(w && state.nodes[w.from.node]) q.push(w.from.node); });
  while(q.length){
    const id = q.pop(); if(seen.has(id)) continue; seen.add(id);
    const n = state.nodes[id]; if(!n || n.type==='accumulate') continue;
    if((n.type==='attractorfield'||n.type==='vortexfield') &&
       ['x','y','z'].some(k=>{ const w=findWireInto(id,k); return w && grp.some(g=>upstreamReaches(w.from.node,g)); })) res.push(id);
    const def = NODE_DEFS[n.type];
    nodeAllInputs(n.type, n).forEach(sk=>{ const w=findWireInto(id,sk.k); if(w && state.nodes[w.from.node]) q.push(w.from.node); });
  }
  return res;
}

// [v9] 루프 불변 코드 끌어올리기(LICM).
// 진짜 원인 #2: Accumulate는 in 상류 전체를 N번 복사해 펼친다. 노이즈처럼 "시간·상태와 무관한" 노드(예: noise3d ×3, perlin 3옥타브)까지
// 매 스텝 통째로 복사돼, 식이 EXPR_SOFT_MAX(55KB)를 넘으면 내보내기 단계가 분할 수를 N=8→…→1로 자동 축소했다.
// → 15초를 단 한 번의 오일러 스텝으로 계산(samples를 올려도 무시됨). 아무리 적분식을 고쳐도 한 스텝으론 물리가 성립하지 않는다.
// 해결: 시간(tv)·적분 상태에 의존하지 않는 대입문은 루프 밖에서 한 번만 계산한다(결과는 비트 단위로 동일).
// 안전장치: 같은 변수를 불변/가변 문장이 섞어 대입하거나, 불변 변수를 여러 번 대입하는데 가변 문장이 읽으면 호이스팅을 포기한다.
function hoistInvariant(body, seeds){
  const stmts = body.split(';').filter(s=>s.trim().length);
  const vre = /v\.[A-Za-z0-9_]+/g, variant = new Set(seeds);
  const info = stmts.map(st=>{ const k=st.indexOf('='); if(k<=0) return null; const lhs=st.slice(0,k).trim(); return /^v\.[A-Za-z0-9_]+$/.test(lhs) ? {st, lhs, rhs:st.slice(k+1)} : null; });
  if(info.some(x=>!x)) return {inv:'', vary:body};
  // [v10.2] 고정점까지 반복: 본문 뒤쪽에서 대입되는(이전 스텝 값을 읽는) 변수를 앞에서 읽는 문장도 스텝마다 달라진다.
  // 한 번만 훑으면 이런 문장(예: 벽의 직전 위치를 읽는 문장)이 불변으로 잘못 분류돼 루프 밖으로 빠졌다.
  let cls, grew = true;
  while(grew){
    const before = variant.size;
    cls = info.map(x=>{
      const refs = x.rhs.match(vre)||[];
      const isVar = refs.some(r=>variant.has(r)) || /math\.random|math\.die_roll/.test(x.rhs);
      if(isVar) variant.add(x.lhs);
      return isVar;
    });
    grew = variant.size !== before;
  }
  const byVar = new Map();
  info.forEach((x,i)=>{ const e = byVar.get(x.lhs)||{inv:0,vary:0}; if(cls[i]) e.vary++; else e.inv++; byVar.set(x.lhs,e); });
  for(const [,e] of byVar) if(e.inv && e.vary) return {inv:'', vary:body};
  const multiInv = new Set([...byVar].filter(([,e])=>e.inv>1).map(([k])=>k));
  if(multiInv.size && info.some((x,i)=>cls[i] && (x.rhs.match(vre)||[]).some(r=>multiInv.has(r)))) return {inv:'', vary:body};
  return { inv: info.filter((x,i)=>!cls[i]).map(x=>x.st+';').join(''), vary: info.filter((x,i)=>cls[i]).map(x=>x.st+';').join('') };
}

// Molang: 필드가 내보내는 강성 변수 이름
// [v10.5] 소용돌이 축 성분별 강성 비율 (1 − a_i²): 축 방향 성분은 빨려 들지 않으므로 0.
function vortexAxisFactor(n, i){
  const d=n.data||{}; let ax=d.axisX!==undefined?d.axisX:0, ay=d.axisY!==undefined?d.axisY:1, az=d.axisZ!==undefined?d.axisZ:0;
  const L=Math.sqrt(ax*ax+ay*ay+az*az)||1; const a=[ax/L,ay/L,az/L][i]; return Number(pnum(1-a*a));
}
// 필드의 출력 소켓(sock)이 노드 targetId(Accumulate)까지 이어지는지(아래쪽으로 탐색, 다른 Accumulate에서 멈춤)
function socketFeeds(fid, sock, targetId){
  const W = Object.values(state.wires), q = W.filter(w=>w.from.node===fid && w.from.socket===sock).map(w=>w.to.node), seen = new Set();
  while(q.length){ const id=q.pop(); if(id===targetId) return true; if(seen.has(id)) continue; seen.add(id);
    const n=state.nodes[id]; if(!n || n.type==='accumulate') continue; W.forEach(w=>{ if(w.from.node===id) q.push(w.to.node); }); }
  return false;
}
function fieldAxisFor(fid, accId){ const i=['fx','fy','fz'].findIndex(sk=>socketFeeds(fid,sk,accId)); return i<0?undefined:i; }
// 노드(예: Formula)가 그룹 구성원 중 정확히 하나의 Accumulate로만 이어지면 그 id
function feedsSingleMember(nid, memIds){
  const W = Object.values(state.wires), q = W.filter(w=>w.from.node===nid).map(w=>w.to.node), seen = new Set(), hit = new Set();
  while(q.length){ const id=q.pop(); if(seen.has(id)) continue; seen.add(id); if(memIds.includes(id)){ hit.add(id); continue; }
    const n=state.nodes[id]; if(!n || n.type==='accumulate') continue; W.forEach(w=>{ if(w.from.node===id) q.push(w.to.node); }); }
  return hit.size===1 ? [...hit][0] : null;
}
function fieldStiffVars(fid, ctx, grid, axisIdx){
  const n = state.nodes[fid], r = {lam:[], cd:[]};
  if(!n) return r;
  // [v10.5] 고정 격자(grid)에서는 소용돌이의 유입률 κ도 축 성분별 강성으로 넘긴다 → 노이즈처럼 일정하게 미는 힘의
  // 평형 위치가 스텝 크기와 무관하게 정확(n/κ). (소용돌이는 Accumulate가 곱할 φ만큼 미리 나눠서 자기 이동은 그대로 정확)
  if(grid && axisIdx!==undefined && n.type==='vortexfield' && fieldIntegrationOrder(fid)===1 && vortexAxisFactor(n,axisIdx)>0) r.lam.push(varNameFor(fid,'lam'+'xyz'[axisIdx],ctx));
  if(n.type==='attractorfield'){ r.lam.push(varNameFor(fid,'lam',ctx)); if((n.data.drag||0)>0) r.cd.push(varNameFor(fid,'cd',ctx)); }
  else if(n.type==='vortexfield' && fieldIntegrationOrder(fid)===2) r.cd.push(varNameFor(fid,'cd',ctx));
  return r;
}
// 적분 보정 계수 (수치 버전). isVel: 2계(속도 단계)
function stiffFactorNum(isVel, h, lam, cd){
  if(isVel) return 1/(1+h*cd+h*h*lam);
  const z = Math.max(h*lam, 1e-4);
  return (1-Math.exp(-z))/z;
}
// 적분 보정 계수 (Molang 문자열). {pre: 선행 대입문, expr: 곱할 식} — 강성이 없으면 expr=''
function stiffFactorMolang(isVel, hE, lamList, cdList, zVar){
  if(!lamList.length && !cdList.length) return {pre:'', expr:''};
  const lamS = lamList.length ? lamList.join('+') : '0.0', cdS = cdList.length ? cdList.join('+') : '0.0';
  if(isVel) return {pre:'', expr:`(1.0/(1.0+(${hE})*(${cdS})+(${hE})*(${hE})*(${lamS})))`};
  if(!lamList.length) return {pre:'', expr:''};
  return {pre:`${zVar}=math.max((${hE})*(${lamS}),0.0001);`, expr:`((1.0-math.exp(-${zVar}))/${zVar})`};
}

// Vortex field: 축(axis) 둘레의 "흐름 속도장 u(x)"를 정의한다.
//   u = sw·[ (axis×r) − pull·r ] / √(r²+rc²)          (r = 축에 수직인 반경 벡터, sw = strength·w(r))
//     → 각속도 Ω = sw/√(r²+rc²), 유입률 κ = pull·Ω. 접선속도는 코어 프로파일 r/√(r²+rc²)로 축 특이점이 없다.
//  [1계 그래프: 힘→위치 직결] 입자는 흐름을 따라 이동한다(ẋ=u). 한 스텝 h 동안의 선형 흐름 정확해
//        r⁺ = e^(−κh)·[cos(Ωh)·r + sin(Ωh)·(axis×r)]
//     를 (r⁺−r)/h 힘으로 내보낸다 → h가 1.9초여도 반지름이 불어나지 않고, inwardPull>0이면 정확히 e^(−κh)로 모인다.
//     (구심 가속 항은 "가속도"라서 1계에선 의미가 없어 쓰지 않는다.)
//  [2계 그래프: 힘→속도→위치] F = k·(u − w·v) + a_c,  a_c = −|u_θ|²·r/(r²+rc²) (흐름과 함께 도는 입자의 구심 가속).
//     드래그 k·w는 Accumulate가 음해적으로 처리하도록 cd(=k·w)로 함께 내보낸다.
// 반환: [fx,fy,fz, lam(위치 강성), cd(속도 감쇠)]
function vortexFieldForce(x,y,z, data, overrides){
  overrides = overrides || {};
  const cx=data.cx||0, cy=data.cy||0, cz=data.cz||0;
  let ax=data.axisX!==undefined?data.axisX:0, ay=data.axisY!==undefined?data.axisY:1, az=data.axisZ!==undefined?data.axisZ:0;
  const alen = Math.sqrt(ax*ax+ay*ay+az*az)||1;
  ax/=alen; ay/=alen; az/=alen;
  const dx=x-cx, dy=y-cy, dz=z-cz;
  const dot = dx*ax+dy*ay+dz*az;
  const rx=dx-ax*dot, ry=dy-ay*dot, rz=dz-az*dot;       // 축에 수직인 반경 벡터
  const r2 = rx*rx+ry*ry+rz*rz, rlen = Math.sqrt(r2);
  const radius = Math.max(0.01, overrides.radius!==undefined?overrides.radius:(data.radius!==undefined?data.radius:3));
  const falloff = data.falloff!==undefined?data.falloff:1;
  const w = falloff<=0 ? (rlen<=radius?1:0) : Math.pow(Math.max(0,Math.min(1,1-rlen/radius)), falloff);
  if(w<=0) return [0,0,0,0,0];
  const rc = Math.max(0.01, data.core!==undefined?data.core:0.3), rc2 = rc*rc;
  const den = Math.sqrt(r2+rc2);
  const sw = (overrides.strength!==undefined?overrides.strength:(data.strength!==undefined?data.strength:1)) * w;
  const pull = data.inwardPull||0;
  const k = data.drag!==undefined?data.drag:1;
  const tx = ay*rz-az*ry, ty = az*rx-ax*rz, tz = ax*ry-ay*rx;   // axis × r (크기 = rlen)
  const order = overrides.order!==undefined ? overrides.order : 2;
  if(order===1){
    const h = Math.max(1e-4, overrides.h||1/60);
    const Om = sw/den, ka = pull*Om;
    // [v10] orbit radius r0: 반경 방향은 r → r0 로 지수 수렴(r⁺ = r0 + (r−r0)e^(−κh)), 각도는 Ωh 회전. r0=0이면 기존과 동일.
    const r0 = Math.max(0, data.orbitRadius||0);
    const E = Math.exp(-ka*h), rn = r0>0 ? r0 + (rlen-r0)*E : rlen*E, q = rn/Math.max(rlen,1e-4);
    // [v10] 회전각 = ∫Ω(r(t))dt. 이전엔 스텝 시작 반경의 Ω로 h 전체를 돌려서, 스텝이 크면(앞쪽 스텝) 회전각이 크게 틀리고
    // 프레임마다 그 오차가 달라져 고리 위 입자가 앞뒤로 튀었다. r(t)가 e^(−κt)로 r⁺에 수렴하므로 Ω(t) ≈ Ω⁺ + (Ω−Ω⁺)e^(−κt)로 적분한다.
    const wn = falloff<=0 ? (rn<=radius?1:0) : Math.pow(Math.max(0,Math.min(1,1-rn/radius)), falloff);
    const Omn = (sw/Math.max(w,1e-9))*wn/Math.sqrt(rn*rn+rc2);
    const th = Omn*h + (Om-Omn)*(Math.abs(ka)>1e-6 ? (1-E)/ka : h);
    const A = (q*Math.cos(th)-1)/h, B = q*Math.sin(th)/h;
    return [A*rx+B*tx, A*ry+B*ty, A*rz+B*tz, 0, 0];
  }
  const r0v = Math.max(0, data.orbitRadius||0), pq = pull*(r0v>0 ? 1 - r0v/Math.max(rlen,1e-4) : 1); // [v10] r0로 향하는 반경 흐름
  const ux = sw*(tx - pq*rx)/den, uy = sw*(ty - pq*ry)/den, uz = sw*(tz - pq*rz)/den;
  const uth2 = sw*sw*r2/(r2+rc2);
  const ac = -uth2/(r2+rc2);
  const vx=overrides.vx||0, vy=overrides.vy||0, vz=overrides.vz||0;
  return [k*(ux-w*vx)+ac*rx, k*(uy-w*vy)+ac*ry, k*(uz-w*vz)+ac*rz, 0, k*w];
}

// Attractor field: 한 점(cx,cy,cz)을 향한 인력(+)/척력(-). 보존력 + 점성 감쇠.
//   F = s·w(r)·g(r)·d − c·w(r)·v,   d = center − x,   w(r) = (1 − r²/R²)²  (r≥R에서 0)   ※ R≤0 이면 w≡1 (무제한 사거리)
//   linear : g = 1/√(r²+ε²)          → |F|≈s·w (멀리서 일정한 흡입), 중심 근처 F≈s·d/ε 인 선형 스프링
//   inverse: g = ε²/(r²+ε²)^(3/2)    → Plummer 소프트닝 중력: 멀리서 s·ε²/r², 중심에서 0으로 연속
// 반환: [fx,fy,fz, lam, cd]  lam = max(0,s)·w·g = 중심 방향 복원 강성(힘/거리), cd = c·w (속도 감쇠율)
//   Accumulate는 이 값으로 스텝을 음해적/지수적으로 보정해 어떤 스텝 크기에서도 중심에 수렴하게 한다.
function attractorFieldForce(x,y,z, data, overrides){
  overrides = overrides || {};
  const cx=data.cx||0, cy=data.cy||0, cz=data.cz||0;
  const dx=cx-x, dy=cy-y, dz=cz-z;
  const r2 = dx*dx+dy*dy+dz*dz;
  const radiusRaw = overrides.radius!==undefined?overrides.radius:(data.radius!==undefined?data.radius:3);
  const radius = Math.max(0.01, radiusRaw);
  const q = radiusRaw>0 ? Math.min(1, r2/(radius*radius)) : 0;   // radius<=0: 무제한 사거리(진짜 중력)
  const w = (1-q)*(1-q);
  if(w<=0) return [0,0,0,0,0];
  const strength = overrides.strength!==undefined?overrides.strength:(data.strength!==undefined?data.strength:1);
  const eps = Math.max(0.01, data.minDistance!==undefined?data.minDistance:0.2), e2 = eps*eps;
  const g = data.falloffMode==='inverse' ? e2/((r2+e2)*Math.sqrt(r2+e2)) : 1/Math.sqrt(r2+e2);
  let sg = strength*w*g;
  // [v10] 1계(힘→위치 직결) 그래프: 인력 노드가 자기 힘만 지수 보정한다 — 한 스텝에 (1−e^(−hλ))만큼 중심으로 이완(정확, 무조건 안정).
  // 이전엔 Accumulate가 in 전체에 φ를 곱해서 벽 보정 a+(b−c)/dt까지 같이 줄였다 → 벽을 뚫고/튕겨나간 채 인력점에 못 붙음.
  if(overrides.order===1 && overrides.h>0){
    // 척력(sg<0): 정확한 해는 힘이 0이 되는 반경 R을 넘지 않는다. 한 스텝에 R 밖까지 날아가는 오버슈트를 막는다.
    if(sg<0 && radiusRaw>0){ const r = Math.sqrt(r2), m = overrides.h*(-sg)*r; if(m>1e-9) sg *= Math.min(1, Math.max(0, radius-r)/m); }
  }
  const c = (data.drag||0)*w;
  const vx=overrides.vx||0, vy=overrides.vy||0, vz=overrides.vz||0;
  return [dx*sg - c*vx, dy*sg - c*vy, dz*sg - c*vz, Math.max(0,sg), c];
}

// 2D 회전 헬퍼 — noise3d의 rotateEnabled 미리보기용(emitter_age*rotateStep*speed에 대응).
function _rot2(x,y,deg){
  const r = deg*Math.PI/180, c=Math.cos(r), s=Math.sin(r);
  return [x*c-y*s, x*s+y*c];
}

// 노드 미리보기 캔버스를 실제로 그린다. 노이즈/커얼노이즈/그라디언트/커브 타입별로 분기.
// t: 시뮬레이션 경과 시간(초, v.emitter_age에 대응) — 재생 중일 때만 0이 아닌 값이 들어오며,
// 노드의 speed/rotateStep/cycleOffsetStep 등 실제 export 로직과 같은 파라미터로 좌표를 흔들어
// "실제로 게임에서 흐르면 이렇게 움직인다"는 감을 미리 보여준다.
// 미리보기 전용: x/y/z(또는 a/b/c/d) 입력 소켓에 연결된 업스트림 노드를 실제로 "숫자 하나"로
// 평가한다. export(resolveInput/buildGraph)는 노드 타입을 가리지 않고 뭐든 연결하면 그 상류를
// 통째로 Molang 라인으로 컴파일하므로, 미리보기도 최대한 같은 범위(연결 가능한 모든 노드 타입)를
// 흉내낸다. depth로 순환/과도한 재귀를 방지.
let _accSim = null;
// Accumulate 중첩 시 총 분할 수(바깥 N × 안쪽 N × ...)의 상한. 초과하면 안쪽 N을 자동으로 낮춘다.
let ACC_BUDGET = 32; // 식이 너무 커지면(수십~수백KB) JS 엔진이 최적화를 포기해 프레임당 수 초가 걸린다(측정: 64분할 1.2초, 16분할 0.04초)
function accCapN(prodOuter){ return Math.max(1, Math.min(32, Math.floor(ACC_BUDGET/Math.max(1,prodOuter)))); }
let _accProd = 1; // 미리보기용: 현재 적분 중인 바깥 Accumulate들의 N 곱
let _accDt = 1/60, _accDtF = 0; // _accDtF: 1계 적분 중 Formula dt(=h·φ), 0이면 _accDt // [v8-5-4] 프리뷰에서 Formula의 dt (Accumulate 적분 안에서만 스텝 길이) // [v8-2-4] Accumulate 미리보기 lock-step 적분 상태
function evalUpstreamForPreview(fromNode, baseX, baseY, baseZ, t, depth){
  depth = depth||0;
  if(!fromNode || (depth>(_accSim?40:6))) return 0;
  switch(fromNode.type){
    case 'noise3d':{
      const wScale = findWireInto(fromNode.id,'scale'), wAmp = findWireInto(fromNode.id,'amplitude');
      const amp = wAmp ? scalarFromWire(wAmp, baseX,baseY,baseZ,t,depth+1) : (fromNode.data.amplitude!==undefined?fromNode.data.amplitude:1);
      const scale = wScale ? scalarFromWire(wScale, baseX,baseY,baseZ,t,depth+1) : (fromNode.data.scale!==undefined?fromNode.data.scale:0.5);
      return evalNoiseNode(fromNode.data, baseX*scale, baseY*scale, baseZ*scale) * amp;
    }
    case 'curlnoise':{
      const wScale = findWireInto(fromNode.id,'scale');
      const scale = wScale ? scalarFromWire(wScale, baseX,baseY,baseZ,t,depth+1) : (fromNode.data.scale!==undefined?fromNode.data.scale:0.5);
      let pz = baseZ*scale;
      if(fromNode.data.flowEnabled){
        const fSpeed = fromNode.data.flowSpeed!==undefined?fromNode.data.flowSpeed:0.2;
        pz += (t||0)*fSpeed;
      }
      const f = curlNoise3D(baseX*scale, baseY*scale, pz, fromNode.data.seed||0);
      // 어느 출력 소켓(fx/fy/fz)인지는 호출부(scalarFromWire)가 wire.from.socket으로 성분을 선택.
      return f; // [fx,fy,fz] 배열 반환
    }
    case 'vecfield_image':{
      const grid = fromNode.data.bakedGrid;
      if(!grid) return 0;
      const res = Math.round(fromNode.data.resolution||16);
      const area = fromNode.data.areaSize||4;
      const gx = Math.max(0, Math.min(res-1, Math.floor(((baseX/area)+0.5)*res)));
      const gy = Math.max(0, Math.min(res-1, Math.floor(((baseY/area)+0.5)*res)));
      const cellData = grid[gy*res+gx];
      return cellData || [0,0];
    }
    case 'curlturb':{
      const wScale = findWireInto(fromNode.id,'scale');
      const scale = wScale ? scalarFromWire(wScale, baseX,baseY,baseZ,t,depth+1) : (fromNode.data.scale!==undefined?fromNode.data.scale:0.5);
      const octaves = Math.max(1, Math.min(6, Math.round(fromNode.data.octaves!==undefined?fromNode.data.octaves:3)));
      const lacunarity = fromNode.data.lacunarity!==undefined?fromNode.data.lacunarity:2;
      const gain = fromNode.data.gain!==undefined?fromNode.data.gain:0.5;
      let pz = baseZ*scale;
      if(fromNode.data.flowEnabled){
        const fSpeed = fromNode.data.flowSpeed!==undefined?fromNode.data.flowSpeed:0.2;
        pz += (t||0)*fSpeed;
      }
      const f = curlTurbulence3D(baseX*scale, baseY*scale, pz, fromNode.data.seed||0, octaves, lacunarity, gain);
      return f; // [fx,fy,fz] 배열 반환
    }
    case 'windzone':{
      const wStrength = findWireInto(fromNode.id,'strength');
      const overrides = {};
      if(wStrength) overrides.strength = scalarFromWire(wStrength, baseX,baseY,baseZ,t,depth+1);
      if(fromNode.data.gustEnabled){
        const gFreq = fromNode.data.gustFreq!==undefined?fromNode.data.gustFreq:1;
        const gAmt = fromNode.data.gustAmount!==undefined?fromNode.data.gustAmount:0.5;
        const base = overrides.strength!==undefined?overrides.strength:(fromNode.data.strength!==undefined?fromNode.data.strength:1);
        overrides.strength = base*(1+Math.sin((t||0)*gFreq*2*Math.PI)*gAmt);
      }
      return windZoneForce(baseX, baseY, baseZ, fromNode.data, overrides);
    }
    case 'vortexfield':{
      const wStrength = findWireInto(fromNode.id,'strength'), wRadius = findWireInto(fromNode.id,'radius');
      const overrides = {};
      if(wStrength) overrides.strength = scalarFromWire(wStrength, baseX,baseY,baseZ,t,depth+1);
      if(wRadius) overrides.radius = scalarFromWire(wRadius, baseX,baseY,baseZ,t,depth+1);
      ['vx','vy','vz'].forEach(k=>{ const wv=findWireInto(fromNode.id,k); if(wv) overrides[k] = scalarFromWire(wv, baseX,baseY,baseZ,t,depth+1); });
      if(fromNode.data.pulseEnabled){
        const pFreq = fromNode.data.pulseFreq!==undefined?fromNode.data.pulseFreq:1;
        const pAmt = fromNode.data.pulseAmount!==undefined?fromNode.data.pulseAmount:0.5;
        const base = overrides.strength!==undefined?overrides.strength:(fromNode.data.strength!==undefined?fromNode.data.strength:1);
        overrides.strength = base*(1+Math.sin((t||0)*pFreq*2*Math.PI)*pAmt);
      }
      // [미리보기 수정] x/y/z 입력 소켓이 연결돼 있으면 그 값(예: 위치 Accumulate 출력)에서 힘을 평가한다.
      // 기존엔 소켓을 무시하고 항상 스폰 기준점(baseX/Y/Z)에서만 평가해, 위치→힘→속도→위치 피드백이 미리보기에서 끊겨
      // 힘이 한 번도 위치에 반영되지 않았다(export 쪽 resolveInput은 이미 소켓을 읽고 있었음).
      const _pc = ['x','y','z'].map((k,i)=>{ const wv=findWireInto(fromNode.id,k); return wv ? scalarFromWire(wv, baseX,baseY,baseZ,t,depth+1) : [baseX,baseY,baseZ][i]; });
      overrides.order = fieldIntegrationOrder(fromNode.id); overrides.h = _accDt;
      return vortexFieldForce(_pc[0], _pc[1], _pc[2], fromNode.data, overrides);
    }
    case 'attractorfield':{
      const wStrength = findWireInto(fromNode.id,'strength'), wRadius = findWireInto(fromNode.id,'radius');
      const overrides = {};
      if(wStrength) overrides.strength = scalarFromWire(wStrength, baseX,baseY,baseZ,t,depth+1);
      if(wRadius) overrides.radius = scalarFromWire(wRadius, baseX,baseY,baseZ,t,depth+1);
      ['vx','vy','vz'].forEach(k=>{ const wv=findWireInto(fromNode.id,k); if(wv) overrides[k] = scalarFromWire(wv, baseX,baseY,baseZ,t,depth+1); });
      if(fromNode.data.pulseEnabled){
        const pFreq = fromNode.data.pulseFreq!==undefined?fromNode.data.pulseFreq:1;
        const pAmt = fromNode.data.pulseAmount!==undefined?fromNode.data.pulseAmount:0.5;
        const base = overrides.strength!==undefined?overrides.strength:(fromNode.data.strength!==undefined?fromNode.data.strength:1);
        overrides.strength = base*(1+Math.sin((t||0)*pFreq*2*Math.PI)*pAmt);
      }
      // [미리보기 수정] x/y/z 입력 소켓이 연결돼 있으면 그 값(예: 위치 Accumulate 출력)에서 힘을 평가한다.
      // 기존엔 소켓을 무시하고 항상 스폰 기준점(baseX/Y/Z)에서만 평가해, 위치→힘→속도→위치 피드백이 미리보기에서 끊겨
      // 힘이 한 번도 위치에 반영되지 않았다(export 쪽 resolveInput은 이미 소켓을 읽고 있었음).
      const _pc = ['x','y','z'].map((k,i)=>{ const wv=findWireInto(fromNode.id,k); return wv ? scalarFromWire(wv, baseX,baseY,baseZ,t,depth+1) : [baseX,baseY,baseZ][i]; });
      overrides.order = fieldIntegrationOrder(fromNode.id); overrides.h = _accDt;
      return attractorFieldForce(_pc[0], _pc[1], _pc[2], fromNode.data, overrides);
    }
    case 'directionalfield':{
      const d = fromNode.data;
      let dx=d.dirX!==undefined?d.dirX:0, dy=d.dirY!==undefined?d.dirY:-1, dz=d.dirZ!==undefined?d.dirZ:0;
      const dlen = Math.sqrt(dx*dx+dy*dy+dz*dz)||1;
      dx/=dlen; dy/=dlen; dz/=dlen;
      const wStrength = findWireInto(fromNode.id,'strength');
      let strength = wStrength ? scalarFromWire(wStrength, baseX,baseY,baseZ,t,depth+1) : (d.strength!==undefined?d.strength:1);
      if(d.gustEnabled){
        const gFreq = d.gustFreq!==undefined?d.gustFreq:1;
        const gAmt = d.gustAmount!==undefined?d.gustAmount:0.5;
        strength = strength*(1+Math.sin((t||0)*gFreq*2*Math.PI)*gAmt);
      }
      return [dx*strength, dy*strength, dz*strength];
    }
    case 'dragfield':{
      // v5: dragfield는 이제 스칼라(drag coefficient) 출력 — Bedrock 내장 linear_drag_coefficient에
      // 직접 매핑되므로 fx/fy/fz 벡터가 아니다. force 미리보기 캔버스(vortex/attractor 전용)에는
      // 원래 연결될 일이 없는 노드지만, 안전하게 계수값만 반환한다.
      const wCoeff = findWireInto(fromNode.id,'coeff');
      const coeff = wCoeff ? scalarFromWire(wCoeff, baseX,baseY,baseZ,t,depth+1) : (fromNode.data.dragCoeff!==undefined?fromNode.data.dragCoeff:0.5);
      return coeff;
    }
    case 'constant':
      if(constVarName(fromNode.data)) return Number.isFinite(+fromNode.data.previewValue) ? +fromNode.data.previewValue : 0;
      return Number.isFinite(+fromNode.data.value) ? +fromNode.data.value : 0;
    case 'accumulate':{
      // [v8-5] 상태 없는 누적: out = init + ∫0..t in(τ)dτ 를 중점 리만합으로 즉시 계산(export와 동일 구조).
      // 자기 출력을 읽는 피드백은 _accSim(Map)에 직전 샘플 값을 넣어 돌려준다.
      if(_accSim && _accSim.has(fromNode.id)) return _accSim.get(fromNode.id);
      const accGrpP = accFeedbackGroup(fromNode.id).filter(id=>state.nodes[id]);
      if(accGrpP.length>1){
        // [v8-5-4] 상호 피드백 그룹: export와 같이 한 상태 벡터로 N개 중점 시각에서 동시에 전진.
        const ms = accGrpP.map(id=>{
          const nd = state.nodes[id], dd = nd.data, wI = findWireInto(id,'init');
          const lo = Number.isFinite(+dd.min)?+dd.min:0, hi = Number.isFinite(+dd.max)?+dd.max:1;
          return { id, dd, lo, hi, wIn:findWireInto(id,'in'), wRs:findWireInto(id,'reset'),
            init: wI ? (Number(scalarFromWire(wI, baseX,baseY,baseZ,0,depth+1))||0) : (Number.isFinite(+dd.init)?+dd.init:0),
            rate0: Number.isFinite(+dd.rate)?+dd.rate:1, k60: dd.mode==='perframe'?60:1, damp: Math.max(0,+dd.damping||0), a:0, hold:0, fields: accStiffFields(id, accGrpP), isVel: accIsVelocityLike(id), N: Math.max(1,Math.min(32,Math.round(+dd.samples||8))) };
        });
        const Tg = Math.max(0, t||0), Ng = Math.min(accCapN(_accProd), Math.max(...ms.map(m=>Math.max(1,Math.min(32,Math.round(+m.dd.samples||8)))))), prodPrevG = _accProd;
        const schP = accSchedule(Ng, accTmax(), accModeOf(ms.map(m=>m.dd.stepDist), ms.map(m=>m.id)));
        const prevG = _accSim, prevDtG = _accDt, prevDtFG = _accDtF; _accProd = prodPrevG*Ng;
        _accSim = new Map(prevG||[]); _accDt = schP.dtAt(0,Tg)*ms[0].k60;
        const msOrd = accOrderGroup(ms.map(m=>m.id)).map(id=>ms.find(m=>m.id===id));
        try{
          ms.forEach(m=>_accSim.set(m.id, m.init+m.a));
          for(let k=0;k<Ng;k++){
            const tau = schP.midAt(k,Tg); _accDt = Math.max(schP.dtAt(k,Tg)*ms[0].k60, 1e-4);
            msOrd.forEach(m=>{
              // 노드별 samples(export와 동일): r스텝 구간의 중간에서 in을 표본, 마지막 스텝에서 L×dt로 갱신
              const r0 = Math.max(1, Math.round(Ng/m.N)), st0 = Math.floor(k/r0)*r0, en0 = Math.min(st0+r0, Ng), md0 = Math.floor((st0+en0-1)/2);
              if(k===md0){
                m.ff1 = 1;
                if(m.fields.length && !m.isVel){ // [v10.2] 1계: 지수 오일러 φ를 먼저 구해 Formula dt=h·φ로 넘김(벽 보정 정확히 유지)
                  let lam=0; m.fields.forEach(fid=>{ const arr = evalUpstreamForPreview(state.nodes[fid], baseX,baseY,baseZ,tau,depth+1); if(Array.isArray(arr)) lam+=arr[3]||0; });
                  m.ff1 = stiffFactorNum(false, _accDt, lam, 0);
                }
                _accDtF = m.ff1!==1 ? _accDt*m.ff1 : 0;
                m.hold = m.wIn ? (Number(scalarFromWire(m.wIn, baseX,baseY,baseZ,tau,depth+1))||0) : m.rate0;
                _accDtF = 0;
              }
              if(k===en0-1){
                const rs = m.wRs ? (Number(scalarFromWire(m.wRs, baseX,baseY,baseZ,tau,depth+1))||0) : 0;
                if(m.wRs) m.a *= Math.max(0, Math.min(1, 1-rs));
                { const hh = schP.spanAt(st0,en0,Tg);
                  let ff = 1;
                  if(!m.isVel) ff = m.ff1||1;
                  else if(m.fields.length){ // [v9] 힘 노드 강성으로 스텝 보정(음해 오일러)
                    let lam=0, cd=0;
                    m.fields.forEach(fid=>{ const arr = evalUpstreamForPreview(state.nodes[fid], baseX,baseY,baseZ,tau,depth+1); if(Array.isArray(arr)){ lam+=arr[3]||0; cd+=arr[4]||0; } });
                    ff = stiffFactorNum(m.isVel, hh*m.k60, lam, cd);
                  }
                  m.a = (m.a + m.hold*ff*hh*m.k60)/(1+m.damp*hh); } // 감쇠는 암시적(무조건 안정)
                if(m.dd.limitMode==='clamp' && m.hi>m.lo) m.a = Math.max(m.lo-m.init, Math.min(m.hi-m.init, m.a));
                _accSim.set(m.id, m.init+m.a); // 갱신 즉시 반영 → 뒤에 오는 구성원은 갱신된 값을 읽음(심플렉틱)
              }
            });
          }
        } finally { _accSim = prevG; _accDt = prevDtG; _accDtF = prevDtFG; _accProd = prodPrevG; }
        const me = ms.find(m=>m.id===fromNode.id);
        let aa = me.a;
        if(me.dd.limitMode==='wrap' && me.hi>me.lo){ const sp=me.hi-me.lo, u=aa-(me.lo-me.init); aa=(me.lo-me.init)+u-sp*Math.floor(u/sp); }
        return me.init + aa;
      }
      const d = fromNode.data;
      const wIn = findWireInto(fromNode.id,'in') || findWireInto(fromNode.id,'rate'), wRs = findWireInto(fromNode.id,'reset'), wInit = findWireInto(fromNode.id,'init');
      const init = wInit ? (Number(scalarFromWire(wInit, baseX,baseY,baseZ,0,depth+1))||0) : (Number.isFinite(+d.init)?+d.init:0);
      const rate0 = Number.isFinite(+d.rate)?+d.rate:1;
      const lo = Number.isFinite(+d.min)?+d.min:0, hi = Number.isFinite(+d.max)?+d.max:1;
      const k60 = d.mode==='perframe' ? 60 : 1;
      const T = Math.max(0, t||0);
      const lim = (a)=>{
        if(d.limitMode==='clamp' && hi>lo) return Math.max(lo-init, Math.min(hi-init, a));
        return a;
      };
      const wrap = (a)=>{
        if(d.limitMode==='wrap' && hi>lo){ const sp=hi-lo, u=a-(lo-init); return (lo-init)+u-sp*Math.floor(u/sp); }
        return a;
      };
      let a = 0;
      const damp = Math.max(0,+d.damping||0);
      if(!wIn && !wRs){ a = wrap(lim(damp>0 ? rate0*k60*(1-Math.exp(-damp*T))/damp : rate0*T*k60)); return init + a; }
      const sFields = accStiffFields(fromNode.id,[fromNode.id]), sIsVel = accIsVelocityLike(fromNode.id);
      const N = Math.max(1, Math.min(accCapN(_accProd), Math.round(+d.samples||8))), prodPrev = _accProd;
      const schS = accSchedule(N, accTmax(), accModeOf([d.stepDist],[fromNode.id])), prev = _accSim, prevDt = _accDt; _accProd = prodPrev*N;
      _accSim = new Map(prev||[]); let dt = schS.dtAt(0,T); _accDt = dt*k60;
      try{
        for(let k=0;k<N;k++){
          const tau = schS.midAt(k,T); dt = schS.dtAt(k,T); _accDt = Math.max(dt*k60, 1e-4);
          _accSim.set(fromNode.id, init+a); // 피드백은 직전 샘플 값
          if(wRs){ const rs = Number(scalarFromWire(wRs, baseX,baseY,baseZ,tau,depth+1))||0; a *= Math.max(0, Math.min(1, 1-rs)); }
          let ffS = 1, lamS = 0, cdS = 0;
          if(sFields.length){ sFields.forEach(fid=>{ const arr = evalUpstreamForPreview(state.nodes[fid], baseX,baseY,baseZ,tau,depth+1); if(Array.isArray(arr)){ lamS+=arr[3]||0; cdS+=arr[4]||0; } }); ffS = stiffFactorNum(sIsVel, dt*k60, lamS, cdS); }
          const prevF = _accDtF; if(!sIsVel && ffS!==1) _accDtF = Math.max(dt*k60,1e-4)*ffS;
          let r = wIn ? (Number(scalarFromWire(wIn, baseX,baseY,baseZ,tau,depth+1))||0) : rate0;
          _accDtF = prevF;
          r *= ffS;
          a = lim((a + r*dt*k60)/(1+damp*dt));
        }
      } finally { _accSim = prev; _accDt = prevDt; _accProd = prodPrev; }
      return init + wrap(a);
    }
    case 'remap':{
      const wIn = findWireInto(fromNode.id,'in');
      const inV = wIn ? scalarFromWire(wIn, baseX,baseY,baseZ,t,depth+1) : 0;
      const d = fromNode.data;
      const inMin=d.inMin!==undefined?d.inMin:-1, inMax=d.inMax!==undefined?d.inMax:1;
      const outMin=d.outMin!==undefined?d.outMin:0, outMax=d.outMax!==undefined?d.outMax:1;
      const span = Math.abs(inMax-inMin)<1e-9 ? 1e-9 : (inMax-inMin);
      let out = ((inV-inMin)/span)*(outMax-outMin)+outMin;
      if(d.clampOut){ const lo=Math.min(outMin,outMax), hi=Math.max(outMin,outMax); out=Math.max(lo,Math.min(hi,out)); }
      return out;
    }
    case 'buoyancyfield':{
      const d = fromNode.data;
      let dx=d.dirX!==undefined?d.dirX:0, dy=d.dirY!==undefined?d.dirY:1, dz=d.dirZ!==undefined?d.dirZ:0;
      const dlen = Math.sqrt(dx*dx+dy*dy+dz*dz)||1;
      dx/=dlen; dy/=dlen; dz/=dlen;
      const wStrength = findWireInto(fromNode.id,'strength');
      const strength = wStrength ? scalarFromWire(wStrength, baseX,baseY,baseZ,t,depth+1) : (d.strength!==undefined?d.strength:1);
      const wTemp = findWireInto(fromNode.id,'temperature');
      let temp, ambient;
      if(wTemp){
        temp = scalarFromWire(wTemp, baseX,baseY,baseZ,t,depth+1);
        ambient = d.ambient!==undefined?d.ambient:0;
      } else if(d.useEmitterAge){
        const cool = d.cooldownCurve!==undefined?d.cooldownCurve:2;
        const dur = Math.max(0.01, d.emitterDuration!==undefined?d.emitterDuration:2);
        // 미리보기에는 실제 emitter_age가 없으므로 재생 타임라인 t(초 단위로 취급)를 그대로 근사로 사용
        const age01 = Math.max(0, Math.min(1, t/dur));
        temp = Math.pow(1-age01, Math.max(0.01,cool));
        ambient = 0;
      } else {
        temp = d.ambient!==undefined?d.ambient:0;
        ambient = d.ambient!==undefined?d.ambient:0;
      }
      const s = (temp-ambient)*strength;
      return [dx*s, dy*s, dz*s];
    }
    case 'dissipationfield':{
      const d = fromNode.data;
      const wIn = findWireInto(fromNode.id,'in');
      let t01;
      if(wIn){ t01 = Math.max(0, scalarFromWire(wIn, baseX,baseY,baseZ,t,depth+1)); }
      else if(d.useEmitterAge){
        const dur = Math.max(0.01, d.emitterDuration!==undefined?d.emitterDuration:2);
        t01 = d.emitterMode==='loop' ? (t/dur)%1 : Math.max(0, Math.min(1, t/dur));
      }
      else { t01 = 0; }
      const start = d.start!==undefined?d.start:1;
      const floor = d.floor!==undefined?d.floor:0;
      const wRate = findWireInto(fromNode.id,'rate');
      let decay;
      if(wRate){
        const rate = scalarFromWire(wRate, baseX,baseY,baseZ,t,depth+1);
        decay = Math.exp(-rate*t01);
      } else {
        const halfLife = Math.max(1e-4, d.halfLife!==undefined?d.halfLife:0.35);
        decay = Math.pow(2, -t01/halfLife);
      }
      return Math.max(floor, start*decay);
    }
    case 'math':{
      // 임의 Molang 수식을 안전하게 JS로 재현하긴 어려우므로, 미리보기에서는 흔한 단순 산술
      // (+ - * / ( ) 와 a/b/c/d/t, 숫자)만 근사 지원한다. 함수 호출 등 그 외 수식은 0으로 폴백.
      const wa=findWireInto(fromNode.id,'a'), wb=findWireInto(fromNode.id,'b'),
            wc=findWireInto(fromNode.id,'c'), wd=findWireInto(fromNode.id,'d'),
            wt=findWireInto(fromNode.id,'t');
      const av = wa ? scalarFromWire(wa, baseX,baseY,baseZ,t,depth+1) : 0;
      const bv = wb ? scalarFromWire(wb, baseX,baseY,baseZ,t,depth+1) : 0;
      const cv = wc ? scalarFromWire(wc, baseX,baseY,baseZ,t,depth+1) : 0;
      const dv = wd ? scalarFromWire(wd, baseX,baseY,baseZ,t,depth+1) : 0;
      const tv = wt ? scalarFromWire(wt, baseX,baseY,baseZ,t,depth+1) : (t||0);
      const expr = (fromNode.data.expr||'0');
      if(/^[\sa-dA-Dt0-9+\-*/.()]*$/.test(expr)){
        try{
          const fn = new Function('a','b','c','d','t','dt', `return (${expr});`);
          const r = fn(av,bv,cv,dv,tv,Math.max(_accDtF||_accDt,1e-4));
          return Number.isFinite(r) ? r : 0;
        }catch(e){ return 0; }
      }
      return 0;
    }
    case 'threshold':{
      const wIn = findWireInto(fromNode.id,'in');
      const inV = wIn ? scalarFromWire(wIn, baseX,baseY,baseZ,t,depth+1) : 0;
      const wEdge = findWireInto(fromNode.id,'edge');
      const d = fromNode.data;
      const th = wEdge ? scalarFromWire(wEdge, baseX,baseY,baseZ,t,depth+1) : (d.threshold!==undefined?d.threshold:0.5);
      const soft = Math.max(0, d.softness||0);
      let out;
      if(soft<1e-6){ out = inV>=th ? 1 : 0; }
      else {
        const lo=th, hi=th+soft;
        const x = Math.max(0, Math.min(1, (inV-lo)/(hi-lo)));
        out = x*x*(3-2*x); // smoothstep
      }
      return d.invert ? 1-out : out;
    }
    default:
      return 0;
  }
}
// wire 하나를 스칼라 값으로 환원(벡터 계열 노드는 연결된 출력 소켓 성분을 선택).
function scalarFromWire(wire, baseX, baseY, baseZ, t, depth){
  const fromNode = state.nodes[wire.from.node];
  if(!fromNode) return 0;
  const result = evalUpstreamForPreview(fromNode, baseX, baseY, baseZ, t, depth);
  if(Array.isArray(result)){
    const socket = wire.from.socket;
    const idx = socket==='fy' ? 1 : socket==='fz' ? 2 : 0;
    const amp = fromNode.data.amplitude!==undefined?fromNode.data.amplitude:1;
    return (result[idx]||0) * ((fromNode.type==='curlnoise'||fromNode.type==='curlturb')?amp:1);
  }
  return result;
}

// ---------------------------------------------------------------------------
// 작은 선형 시스템 Ax=b를 가우스 소거법(부분 피벗)으로 푼다. 외부 라이브러리 없이 순수 JS로
// 정규방정식(A^T A x = A^T b) 풀이에 사용 — 항 개수가 많아야 20~30개 수준이라 이 정도로 충분히 빠르다.
function solveLinearSystem(A, b){
  const n = A.length;
  const M = A.map((row,i)=>[...row, b[i]]);
  for(let col=0; col<n; col++){
    let piv = col;
    for(let r=col+1; r<n; r++){ if(Math.abs(M[r][col])>Math.abs(M[piv][col])) piv = r; }
    if(piv!==col){ const tmp=M[col]; M[col]=M[piv]; M[piv]=tmp; }
    const pivVal = M[col][col];
    if(Math.abs(pivVal)<1e-10) continue; // 특이(거의 0)한 경우 스킵 — 해당 계수는 0에 가깝게 남음
    for(let r=0; r<n; r++){
      if(r===col) continue;
      const factor = M[r][col]/pivVal;
      for(let c=col; c<=n; c++) M[r][c] -= factor*M[col][c];
    }
  }
  return M.map((row,i)=> Math.abs(row[i])<1e-10 ? 0 : row[n]/row[i]);
}

// 그리드(res×res, 한 채널)를 2D 저주파 sin/cos 합으로 최소자승 피팅한다.
// field(x,y) ≈ Σ [ a_i*sin(m_i·π·x + n_i·π·y) + b_i*cos(m_i·π·x + n_i·π·y) ]
// x,y는 -1~1로 정규화된 그리드 좌표. 낮은 (m,n) 정수 주파수부터 numTerms개만 사용해 "저주파"로 제한한다
// (고주파를 포함하면 각지고 복잡해져 항이 늘어나야 하므로, 부드러운 흐름 위주로 근사하는 게 이 방식의 취지).
function fitFourier2D(grid, res, channel, numTerms){
  const freqs = [];
  for(let m=0; m<6 && freqs.length<numTerms+4; m++){
    for(let n=0; n<6 && freqs.length<numTerms+4; n++){
      if(m===0 && n===0) continue;
      freqs.push([m,n]);
    }
  }
  freqs.sort((a,b)=> (a[0]*a[0]+a[1]*a[1]) - (b[0]*b[0]+b[1]*b[1]));
  const chosen = freqs.slice(0, Math.max(1,numTerms));
  const xs=[], ys=[], vals=[];
  for(let gy=0; gy<res; gy++){
    for(let gx=0; gx<res; gx++){
      xs.push((gx/(res-1))*2-1); ys.push((gy/(res-1))*2-1);
      vals.push(grid[gy*res+gx][channel]);
    }
  }
  const nBasis = chosen.length*2;
  const basis = xs.map((x,i)=>{
    const y = ys[i];
    const row = [];
    chosen.forEach(([m,n])=>{
      const phase = m*Math.PI*x + n*Math.PI*y;
      row.push(Math.sin(phase), Math.cos(phase));
    });
    return row;
  });
  // 정규방정식 A^T A c = A^T v (작은 릿지 항으로 수치 안정성 확보)
  const AtA = Array.from({length:nBasis}, ()=> new Array(nBasis).fill(0));
  const Atv = new Array(nBasis).fill(0);
  for(let i=0;i<basis.length;i++){
    const row = basis[i], v = vals[i];
    for(let a=0;a<nBasis;a++){
      Atv[a] += row[a]*v;
      for(let bcol=0; bcol<nBasis; bcol++) AtA[a][bcol] += row[a]*row[bcol];
    }
  }
  for(let a=0;a<nBasis;a++) AtA[a][a] += 1e-4;
  const coeffs = solveLinearSystem(AtA, Atv);
  return chosen.map(([m,n],i)=> ({ m, n, a: coeffs[2*i], b: coeffs[2*i+1] })); // a=sin계수, b=cos계수
}

// ---------------------------------------------------------------------------
// Shape (Image Contour) — 실무 표준 파이프라인: 이미지를 흑백/알파/채널 기준으로 이진화 →
// 외곽선을 한 바퀴 추적(Moore-Neighbor border following, OpenCV findContours와 같은 계열의
// 알고리즘) → 등간격 K개 점으로 재샘플링 → Elliptic Fourier Descriptors(Kuhl & Giardina,
// 1982 — pyefd/ElliShape 등에서 쓰이는 표준 기법)로 x(t)/y(t)를 각각 독립적인 코사인+사인
// 급수로 피팅한다. 결과 계수는 그대로 Molang cos/sin 합으로 옮겨써서 Shape 노드의 exprX/exprZ에
// 채워 넣을 수 있다 — Bedrock Molang은 텍스처 샘플링이 불가능하므로, "이미지를 따라가는 파티클
// 궤적"을 런타임 이미지 접근 없이 순수 삼각함수 다항식으로 미리 근사해두는 방식.
//   x(t) = a0 + Σ [ an*cos(nt) + bn*sin(nt) ]
//   y(t) = c0 + Σ [ cn*cos(nt) + dn*sin(nt) ]   (t: 0~2π, 외곽선을 한 바퀴 도는 매개변수)

// 이진화: mode에 따라 픽셀 하나를 "안(true)/밖(false)"으로 판정.
//  - luminance : 밝기(휘도) 기준. invert=false면 밝은 부분을 전경으로 취급.
//  - alpha     : 알파 채널 기준(투명 배경 PNG의 실루엣 추출에 적합).
//  - redchan/greenchan/bluechan : 특정 채널 값 기준(색상 마스크로 실루엣을 미리 분리해둔 경우).
function binarizeSample(imgData, w, h, x, y, mode, threshold, invert){
  x = Math.max(0, Math.min(w-1, x)); y = Math.max(0, Math.min(h-1, y));
  const i = (y*w+x)*4;
  let v;
  if(mode==='alpha') v = imgData[i+3]/255;
  else if(mode==='redchan') v = imgData[i]/255;
  else if(mode==='greenchan') v = imgData[i+1]/255;
  else if(mode==='bluechan') v = imgData[i+2]/255;
  else v = (imgData[i]*0.299 + imgData[i+1]*0.587 + imgData[i+2]*0.114) / 255; // luminance
  const inside = v >= threshold;
  return invert ? !inside : inside;
}

// Moore-Neighbor 외곽선 추적: 이진 마스크에서 주어진 시작점 하나를 기준으로 닫힌 윤곽선
// 하나를 픽셀 좌표 리스트로 반환한다. 8-이웃 시계방향 추적, OpenCV의 CHAIN_APPROX_NONE급
// 원시 체인코드와 동일한 원리. (다중 덩어리 지원을 위해 시작점을 인자로 분리했다 — traceAllContours 참고)
function traceContourFrom(mask, w, h, start){
  // 표준 Moore-Neighbor border following. 기존 구현은 "이전 이동 방향"만
  // 갱신하면서 시작점 재방문만 검사해, 채워진 도형의 내부 픽셀을 따라가거나
  // 같은 구간을 반복하는 경우가 있었습니다. 시작점/이전 픽셀 쌍을 기준으로
  // 종료하고, 매 단계에서 실제 경계 픽셀만 따라가도록 고정합니다.
  const dirs = [[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1],[0,-1],[1,-1]];
  const inMask = (x,y)=> x>=0 && y>=0 && x<w && y<h && mask[y*w+x];
  const dirIndex = (dx,dy)=>{
    for(let i=0;i<8;i++) if(dirs[i][0]===dx && dirs[i][1]===dy) return i;
    return 0;
  };

  // 시작점은 반드시 경계 픽셀이어야 한다.
  let sx=start[0], sy=start[1];
  if(!inMask(sx,sy)) return null;
  let boundary = false;
  for(const [dx,dy] of dirs){ if(!inMask(sx+dx,sy+dy)){ boundary=true; break; } }
  if(!boundary) return null;

  const startPrev = [sx-1, sy]; // Moore 추적의 초기 backtrack 픽셀(서쪽)
  let px=sx, py=sy;
  let bx=startPrev[0], by=startPrev[1];
  const contour=[];
  const maxSteps = Math.max(32, w*h*8);

  for(let step=0; step<maxSteps; step++){
    contour.push([px,py]);
    const backDir = dirIndex(bx-px, by-py);
    let found=false, nx=px, ny=py, nbx=bx, nby=by;

    // backtrack 픽셀의 다음 방향부터 시계방향으로 탐색.
    for(let k=1;k<=8;k++){
      const d=(backDir+k)%8;
      const tx=px+dirs[d][0], ty=py+dirs[d][1];
      if(inMask(tx,ty)){
        // 선택된 전경 픽셀 바로 이전에 검사했던 이웃을 새 backtrack으로 사용.
        const prevD=(d+7)%8;
        nbx=px+dirs[prevD][0]; nby=py+dirs[prevD][1];
        nx=tx; ny=ty; found=true;
        break;
      }
    }
    if(!found) break;

    px=nx; py=ny; bx=nbx; by=nby;
    if(px===sx && py===sy && bx===startPrev[0] && by===startPrev[1]) break;
  }

  // 정상적인 폐곡선만 반환한다. 마지막에 중복된 시작점이 들어온 경우 제거.
  if(contour.length>1){
    const last=contour[contour.length-1];
    if(last[0]===sx && last[1]===sy) contour.pop();
  }
  return contour.length>=3 ? contour : null;
}

// 이진 마스크에서 서로 분리된(끊어진) 덩어리를 최대 maxContours개까지 순서대로 찾아 각각의
// 외곽선을 추적해 배열로 반환한다. 원리: 위→아래·왼→오 순회로 전경 픽셀을 찾으면 그 덩어리의
// 외곽선을 추적하고, 추적된 외곽선 픽셀들을 마스크 복사본에서 "지워서(0으로)" 다음 탐색 때 같은
// 덩어리를 다시 찾지 않게 한다 — 내부가 빈 도형(외곽선만 있는 마스크)이 아니어도 안전하도록,
// 외곽선 픽셀 자체가 아니라 해당 덩어리와 8-연결된 전경 영역 전체를 플러드필로 지운다.
function traceAllContours(mask, w, h, maxContours){
  const work = mask.slice(); // 원본 보존, 탐색용 복사본에서만 지움
  const contours = [];
  const visited = new Uint8Array(w*h);
  for(let y=0; y<h && contours.length<maxContours; y++){
    for(let x=0; x<w && contours.length<maxContours; x++){
      const idx = y*w+x;
      if(!work[idx] || visited[idx]) continue;
      // filled blob의 내부 픽셀을 시작점으로 쓰면 경계 추적이 깨질 수 있으므로
      // 실제 경계 픽셀을 찾은 뒤 추적한다.
      let startPt = null;
      for(let dy=-1;dy<=1 && !startPt;dy++) for(let dx=-1;dx<=1 && !startPt;dx++){
        if(dx===0 && dy===0) continue;
        const nx=x+dx, ny=y+dy;
        if(nx<0||ny<0||nx>=w||ny>=h || !work[ny*w+nx]) startPt=[x,y];
      }
      if(!startPt) continue;
      const c = traceContourFrom(work, w, h, startPt);
      // 이 덩어리를 8-연결 플러드필로 지워 다음 시작점 탐색에서 재발견되지 않게 한다.
      const stack = [[x,y]];
      visited[idx]=1;
      while(stack.length){
        const [cx,cy] = stack.pop();
        work[cy*w+cx] = 0;
        for(let dy=-1; dy<=1; dy++) for(let dx=-1; dx<=1; dx++){
          if(dx===0 && dy===0) continue;
          const nx=cx+dx, ny=cy+dy;
          if(nx<0||ny<0||nx>=w||ny>=h) continue;
          const nidx = ny*w+nx;
          if(mask[nidx] && !visited[nidx]){ visited[nidx]=1; stack.push([nx,ny]); }
        }
      }
      if(c) contours.push(c);
    }
  }
  return contours;
}

// 픽셀 체인(가변 간격)을 호(arc-length) 기준 등간격 K개 점으로 재샘플링.
// EFD는 원래 등시간 간격(체인코드 스텝)을 가정하지만, 실무에서는 폐곡선 둘레를 따라
// 호 길이 기준으로 고르게 재샘플링해야 뾰족한 모서리 근처에서 점이 과도하게 몰리는 걸 방지한다.
function resampleClosedPolyline(points, K){
  const n = points.length;
  const segLen = new Array(n);
  let total = 0;
  for(let i=0;i<n;i++){
    const a=points[i], b=points[(i+1)%n];
    const d = Math.hypot(b[0]-a[0], b[1]-a[1]);
    segLen[i]=d; total+=d;
  }
  if(total<1e-6) return points.slice(0,K);
  const out = [];
  let acc=0, segIdx=0, segPos=0;
  const step = total/K;
  let target=0;
  for(let k=0;k<K;k++){
    target = k*step;
    while(segIdx<n && acc+segLen[segIdx] < target){ acc+=segLen[segIdx]; segIdx++; }
    if(segIdx>=n) segIdx=n-1;
    const a=points[segIdx], b=points[(segIdx+1)%n];
    const segT = segLen[segIdx]>1e-6 ? (target-acc)/segLen[segIdx] : 0;
    out.push([ a[0]+(b[0]-a[0])*segT, a[1]+(b[1]-a[1])*segT ]);
  }
  return out;
}

// Elliptic Fourier Descriptors 계산 (Kuhl & Giardina 1982 표준식).
// 입력: 등간격 재샘플링된 폐곡선 점 K개. 출력: order개 하모닉의 {an,bn,cn,dn} 배열 + a0,c0(중심).
// x(t) = a0 + Σ an*cos(n*t) + bn*sin(n*t),  y(t) = c0 + Σ cn*cos(n*t) + dn*sin(n*t), t∈[0,2π)
function ellipticFourierDescriptors(points, order){
  const K = points.length;
  const dx = new Array(K), dy = new Array(K), dt = new Array(K);
  let perimeter = 0;
  for(let i=0;i<K;i++){
    const a=points[i], b=points[(i+1)%K];
    dx[i]=b[0]-a[0]; dy[i]=b[1]-a[1];
    dt[i]=Math.hypot(dx[i],dy[i]) || 1e-9;
    perimeter += dt[i];
  }
  const tCum = new Array(K+1); tCum[0]=0;
  for(let i=0;i<K;i++) tCum[i+1] = tCum[i]+dt[i];
  const T = perimeter;
  const harmonics = [];
  for(let n=1; n<=order; n++){
    let an=0, bn=0, cn=0, dn=0;
    const c = T/(2*n*n*Math.PI*Math.PI);
    for(let i=0;i<K;i++){
      const t0 = tCum[i], t1 = tCum[i+1];
      const phase0 = 2*n*Math.PI*t0/T, phase1 = 2*n*Math.PI*t1/T;
      an += (dx[i]/dt[i]) * (Math.cos(phase1)-Math.cos(phase0));
      bn += (dx[i]/dt[i]) * (Math.sin(phase1)-Math.sin(phase0));
      cn += (dy[i]/dt[i]) * (Math.cos(phase1)-Math.cos(phase0));
      dn += (dy[i]/dt[i]) * (Math.sin(phase1)-Math.sin(phase0));
    }
    harmonics.push({ n, an: c*an, bn: c*bn, cn: c*cn, dn: c*dn });
  }
  // DC 성분(a0,c0): 폐곡선의 중심(무게중심에 근접한 값) — Kuhl&Giardina의 A0/C0 적분식.
  let a0=0, c0=0, xi=0, yi=0;
  for(let i=0;i<K;i++){
    const t0=tCum[i], t1=tCum[i+1];
    const xi1 = xi + dx[i];
    const yi1 = yi + dy[i];
    const xiBar = xi - (dx[i]/dt[i])*t0;
    const yiBar = yi - (dy[i]/dt[i])*t0;
    a0 += (dx[i]/(2*dt[i]))*(t1*t1-t0*t0) + xiBar*(t1-t0);
    c0 += (dy[i]/(2*dt[i]))*(t1*t1-t0*t0) + yiBar*(t1-t0);
    xi = xi1; yi = yi1;
  }
  a0 = points[0][0] + a0/T;
  c0 = points[0][1] + c0/T;
  return { a0, c0, harmonics, perimeter: T };
}

// EFD 계수를 이 편집기의 수식 언어(Shape.exprX/Y/Z와 동일한 문법: j,n,h,seed 변수 + cos/sin은
// "도(degree)" 단위 — 이 파일의 FormulaParser/FUNC_MAP이 math.sin/math.cos를 그대로 씀)로 변환한다.
// blobs: [{efd, weight, cumStart, cumEnd}, ...] — bakeContourFromImage에서 둘레 비례로 이미
// 구간이 나뉘어 있다. 덩어리가 1개면 조건문 없는 단일 수식(기존과 동일), 여러 개면 "마스크
// 가중합"으로 결합한다 — 삼항(?:) 없이 순수 산술만으로 "이 파티클이 어느 덩어리를 맡는지"를 고른다.
//
// 원리: frac=j/n(0~1)이 덩어리 i의 구간 [cumStart_i, cumEnd_i) 안에 있는지를 "계단 차분"으로
// 판별한다. passed_i = clamp((frac-cumStart_i)*BIGK, 0, 1) 은 frac이 cumStart_i를 넘으면 1,
// 못 넘으면 0인 부드러운 계단(BIGK를 충분히 크게 잡아 사실상 하드 스텝). 이때
//   mask_i = passed_i - passed_(i+1)
// 는 frac이 정확히 구간 i 안에 있을 때만 1이고 나머지는 0인 "원-핫" 가중치가 된다(마지막 구간은
// passed_(last+1)=0으로 취급). floor/mod/삼항 전혀 없이 clamp+곱셈+뺄셈만으로 구현된다.
// 각 덩어리 안에서의 로컬 진행률은 localFrac_i=clamp((frac-cumStart_i)/weight_i,0,1)로 별도 계산해
// t_i=localFrac_i*360으로 그 덩어리의 외곽선을 한 바퀴 돈다. mask_i=0인 파티클도 t_i 자체는
// clamp로 항상 유효 범위(0~360)라 cos/sin이 NaN 없이 계산되고, 최종 기여만 mask로 사라진다.
function efdToShapeExpr(blobsIn, opts){
  opts = opts||{};
  const scale = opts.scale!==undefined ? opts.scale : 1;
  const flipY = opts.flipY!==undefined ? opts.flipY : true; // 이미지 y축(아래+)을 월드 y축(위+)으로 뒤집기
  const rot = opts.rotateOffsetDeg||0; // 파티클이 t=0에서 시작하는 각도를 j 진행에 맞춰 원하는 만큼 회전(선택)
  const centerRes = opts.res || 128;
  const fmtNum = (v)=> {
    if(Math.abs(v)<1e-12) return '0';
    return pnum(v);
  };
  // 구버전 호출(단일 efd 객체 하나만 넘기는 경우) 호환: blobs 배열로 감싸준다.
  const blobs = Array.isArray(blobsIn) ? blobsIn : [{ efd: blobsIn, weight:1, cumStart:0, cumEnd:1 }];
  const fracExpr = '(v.j/v.n)';
  const BIGK = 100000; // 경계 판별용 스텝 기울기(충분히 커서 사실상 하드 스위치)

  if(blobs.length===1){
    // 덩어리 1개: 마스킹이 필요 없으므로 기존과 동일하게 가장 짧은 형태로 생성.
    const tExpr = rot ? `(${fracExpr}*360+${fmtNum(rot)})` : `(${fracExpr}*360)`;
    const buildAxis = (dc, harmonics, coefKeyCos, coefKeySin, axisScale)=>{
      const centered = (dc - centerRes/2) / (centerRes/2) * axisScale;
      let terms = [ fmtNum(centered) ];
      harmonics.forEach(hterm=>{
        const cosC = hterm[coefKeyCos] / (centerRes/2) * axisScale;
        const sinC = hterm[coefKeySin] / (centerRes/2) * axisScale;
        if(Math.abs(cosC)>1e-6) terms.push(`${fmtNum(cosC)}*cos(${hterm.n}*${tExpr})`);
        if(Math.abs(sinC)>1e-6) terms.push(`${fmtNum(sinC)}*sin(${hterm.n}*${tExpr})`);
      });
      return terms.join('+').replace(/\+-/g,'-');
    };
    const efd = blobs[0].efd;
    const exprX = buildAxis(efd.a0, efd.harmonics, 'an', 'bn', scale);
    const yScale = flipY ? -scale : scale;
    const exprZ = buildAxis(efd.c0, efd.harmonics, 'cn', 'dn', yScale);
    return { exprX, exprZ, tExpr };
  }

  // 덩어리 2개 이상: 각 덩어리마다 passed_i, mask_i, localT_i를 만들고 가중합으로 합친다.
  const passedExpr = (cumStart)=> cumStart<=1e-9 ? '1' : `math.clamp((${fracExpr}-${fmtNum(cumStart)})*${BIGK},0,1)`;
  const passed = blobs.map(b=>passedExpr(b.cumStart));
  const masks = blobs.map((b,i)=>{
    const next = passed[i+1]; // 마지막 덩어리는 다음 구간이 없으니 0 취급(=항상 빼지 않음)
    return next!==undefined ? `(${passed[i]}-${next})` : passed[i];
  });
  const localT = blobs.map(b=>{
    const denom = fmtNum(b.weight||1e-6);
    const local = `math.clamp((${fracExpr}-${fmtNum(b.cumStart)})/${denom},0,1)`;
    return rot ? `(${local}*360+${fmtNum(rot)})` : `(${local}*360)`;
  });
  // x축과 z축을 각각 명시적으로 조립(dc 선택은 dcKey 인자로 통일된 헬퍼에 넘긴다).
  const buildAxis = (dcKey, coefKeyCos, coefKeySin, axisScale)=>{
    const terms = [];
    blobs.forEach((b,i)=>{
      const efd = b.efd;
      const dc = efd[dcKey];
      const centered = (dc - centerRes/2) / (centerRes/2) * axisScale;
      const mask = masks[i];
      if(Math.abs(centered)>1e-6) terms.push(`${mask}*${fmtNum(centered)}`);
      efd.harmonics.forEach(hterm=>{
        const cosC = hterm[coefKeyCos] / (centerRes/2) * axisScale;
        const sinC = hterm[coefKeySin] / (centerRes/2) * axisScale;
        if(Math.abs(cosC)>1e-6) terms.push(`${mask}*${fmtNum(cosC)}*cos(${hterm.n}*${localT[i]})`);
        if(Math.abs(sinC)>1e-6) terms.push(`${mask}*${fmtNum(sinC)}*sin(${hterm.n}*${localT[i]})`);
      });
    });
    return terms.join('+').replace(/\+-/g,'-');
  };
  const exprX = buildAxis('a0', 'an', 'bn', scale);
  const yScale = flipY ? -scale : scale;
  const exprZ = buildAxis('c0', 'cn', 'dn', yScale);
  return { exprX, exprZ, tExpr: localT[0] };
}

/* -------------------------------------------------------------------------
   EFD 수식 분할 생성기
   - Bedrock Molang 파서가 긴 EFD 삼각함수 합을 한 표현식으로 파싱하지 않도록
     harmonicOrder를 작은 구간으로 나눠 각각 독립 문장으로 누적한다.
   - 기본 2차씩: H1~H2, H3~H4, ...
   - 최종 수학적 결과는 기존 efdToShapeExpr()와 동일하다.
   ------------------------------------------------------------------------- */
function efdToShapeExprSegments(blobsIn, opts){
  opts = opts || {};
  const scale = opts.scale!==undefined ? opts.scale : 1;
  const flipY = opts.flipY!==undefined ? opts.flipY : true;
  const rot = opts.rotateOffsetDeg || 0;
  const centerRes = opts.res || 128;
  // IMPORTANT: this is intentionally small. The goal is to keep EVERY individual
  // Molang assignment shallow, not merely to split one huge string into chunks.
  const chunkHarmonics = Math.max(1, Math.floor(opts.chunkHarmonics || 2));
  const prefix = String(opts.prefix || 'efds').replace(/^v\./,'');
  const fmtNum = (v)=>{
    if(Math.abs(v)<1e-12) return '0';
    return pnum(v);
  };
  const blobs = Array.isArray(blobsIn) ? blobsIn :
    [{ efd: blobsIn, weight:1, cumStart:0, cumEnd:1 }];
  // IMPORTANT: use the same logical j/n expressions as the caller.
  // In the split compiler, j/n are not always literal v.j/v.n:
  // off-context uses v.i (+ jOffset) and frame-context uses v.fri (+ jOffset),
  // while n must be the global particle count for a distributed emitter.
  // Hard-coding v.j/v.n here makes the segmented EFD masks/t values diverge
  // from the actual shape coordinates, especially in split/frame compilation.
  const fracJ = opts.jExpr!==undefined ? String(opts.jExpr) : 'v.j';
  const fracN = opts.nExpr!==undefined ? String(opts.nExpr) : 'v.n';
  const fracExpr = `(${fracJ}/${fracN})`;
  const BIGK = 100000;

  // Common expressions are evaluated ONCE into Molang variables.
  // This is the crucial fix: mask/localT are no longer duplicated inside every
  // Fourier term, which was causing the enormous nesting seen in the exported code.
  const setupLines = [];
  const maskVars = [];
  const tVars = [];

  const passedExpr = (cumStart)=> cumStart<=1e-9
    ? '1'
    : `math.clamp((${fracExpr}-${fmtNum(cumStart)})*${BIGK},0,1)`;
  const passed = blobs.map(b=>passedExpr(b.cumStart||0));

  blobs.forEach((b,i)=>{
    const maskVar = `${prefix}m${i}`;
    const tVar = `${prefix}t${i}`;
    const next = passed[i+1];
    const maskExpr = next!==undefined ? `(${passed[i]}-(${next}))` : `(${passed[i]})`;
    const denom = fmtNum(b.weight||1e-6);
    const local = `math.clamp((${fracExpr}-${fmtNum(b.cumStart||0)})/${denom},0,1)`;
    const tExpr = rot ? `(${local}*360+${fmtNum(rot)})` : `(${local}*360)`;
    setupLines.push(`v.${maskVar}=${maskExpr};`);
    setupLines.push(`v.${tVar}=${tExpr};`);
    maskVars.push(maskVar);
    tVars.push(tVar);
  });

  const maxH = blobs.reduce((mx,b)=>{
    const hs = b.efd && Array.isArray(b.efd.harmonics) ? b.efd.harmonics : [];
    return Math.max(mx, hs.length);
  }, 0);
  const chunkCount = Math.max(1, Math.ceil(maxH / chunkHarmonics));

  const buildAxisSegments = (dcKey, cosKey, sinKey, axisScale)=>{
    const chunks = [];
    for(let chunk=0; chunk<chunkCount; chunk++){
      const hStart = chunk*chunkHarmonics;
      const hEnd = hStart + chunkHarmonics;
      const terms = [];
      blobs.forEach((b,i)=>{
        const efd = b.efd;
        if(!efd) return;
        const mask = maskVars[i];
        const tVar = tVars[i];
        if(chunk===0){
          const dc = efd[dcKey];
          const centered = (dc - centerRes/2) / (centerRes/2) * axisScale;
          if(Math.abs(centered)>1e-6) terms.push(`${mask}*${fmtNum(centered)}`);
        }
        const harmonics = Array.isArray(efd.harmonics) ? efd.harmonics : [];
        harmonics.forEach((hterm, idx)=>{
          if(idx<hStart || idx>=hEnd) return;
          const cosC = hterm[cosKey] / (centerRes/2) * axisScale;
          const sinC = hterm[sinKey] / (centerRes/2) * axisScale;
          if(Math.abs(cosC)>1e-6) terms.push(`${mask}*${fmtNum(cosC)}*cos(${hterm.n}*${tVar})`);
          if(Math.abs(sinC)>1e-6) terms.push(`${mask}*${fmtNum(sinC)}*sin(${hterm.n}*${tVar})`);
        });
      });
      chunks.push(terms.length ? terms.join('+').replace(/\+-/g,'-') : '0');
    }
    return chunks;
  };

  const yScale = flipY ? -scale : scale;
  return {
    setupLines,
    xSegments: buildAxisSegments('a0','an','bn',scale),
    zSegments: buildAxisSegments('c0','cn','dn',yScale),
    chunkHarmonics,
    chunkCount
  };
}

function efdReconstructPoint(efd, t){
  let x = efd.a0, y = efd.c0;
  efd.harmonics.forEach(h=>{
    const c = Math.cos(h.n*t), s = Math.sin(h.n*t);
    x += h.an*c + h.bn*s;
    y += h.cn*c + h.dn*s;
  });
  return [x,y];
}

// --- Curve(Over-Life) 편집기: 캔버스를 직접 탭/드래그해서 포인트를 추가·이동·삭제 ---
function curveValueAt(points, t){
  const pts = [...points].sort((a,b)=>a.x-b.x);
  if(t<=pts[0].x) return pts[0].y;
  if(t>=pts[pts.length-1].x) return pts[pts.length-1].y;
  for(let i=0;i<pts.length-1;i++){
    const a=pts[i], b=pts[i+1];
    if(t>=a.x && t<=b.x){
      const f = (b.x-a.x)>1e-6 ? (t-a.x)/(b.x-a.x) : 0;
      return a.y + (b.y-a.y)*f;
    }
  }
  return pts[pts.length-1].y;
}

/* -------------------------------------------------------------------------
   8. 코드 생성기: 그래프 → Molang 표현식들 → Bedrock Particle JSON
      규칙: 노드마다 고유 변수 v.node_<id>_<outkey> 를 생성 (가독성 우선, 인라인 병합 안 함)
   ------------------------------------------------------------------------- */

// [v10.3 최적화] 컴파일·미리보기 중에는 그래프가 바뀌지 않으므로 입력 연결을 Map으로 한 번만 색인해 둔다.
// 이전엔 매 호출마다 모든 연결을 처음부터 훑어서(수십만 번) 추출 시간의 대부분을 차지했다. 결과는 기존 find와 같다(같은 소켓에 여러 개면 먼저 만든 것).
let _wireIdx = null;
function findWireInto(nodeId, socketKey){
  if(_wireIdx) return _wireIdx.get(nodeId+'\u0000'+socketKey);
  return Object.values(state.wires).find(w=>w.to.node===nodeId && w.to.socket===socketKey);
}
function withWireIndex(fn){
  if(_wireIdx) return fn();
  const m = new Map();
  for(const w of Object.values(state.wires)){ const k = w.to.node+'\u0000'+w.to.socket; if(!m.has(k)) m.set(k, w); }
  _wireIdx = m;
  try{ return fn(); } finally { _wireIdx = null; }
}

// [v8-2-4] 피드백(지연) 간선: Accumulate의 in/reset 입력선 중, 그 출처가 (직접·간접으로) 같은
// Accumulate의 출력에 다시 의존하는 선. Unity VFX Graph의 Position/Velocity 속성이나 Blender의
// Simulation Zone처럼 "이전 프레임에 저장된 값"을 읽는 한 프레임 지연 간선으로 취급한다.
// 이런 선은 사이클 검사와 위상 정렬에서 제외되고, 코드 생성 시에는 이전 프레임의 v.* 값을 읽는다.
function upstreamReaches(startId, targetId){
  const seen = new Set(), q = [startId];
  while(q.length){
    const id = q.pop();
    if(id===targetId) return true;
    if(seen.has(id)) continue;
    seen.add(id);
    const n = state.nodes[id]; if(!n) continue;
    const def = NODE_DEFS[n.type];
    nodeAllInputs(n.type, n).forEach(sk=>{
      const w = findWireInto(id, sk.k);
      if(w && state.nodes[w.from.node]) q.push(w.from.node);
    });
  }
  return false;
}
function isFeedbackWire(nodeId, socketKey){
  const n = state.nodes[nodeId];
  if(!n || n.type!=='accumulate' || (socketKey!=='in' && socketKey!=='reset')) return false;
  const w = findWireInto(nodeId, socketKey);
  if(!w || !state.nodes[w.from.node]) return false;
  return upstreamReaches(w.from.node, nodeId);
}

// [v8-5-4] Accumulate 상호 피드백 그룹(강연결 요소).
// X의 in/reset 상류가 Y에 닿고, Y의 in/reset 상류도 X에 닿으면 X·Y는 서로의 적분 입력에 의존하는
// 연립 시스템(예: 위치 x/y/z가 벽 충돌 노드를 거쳐 서로를 되먹임)이다. 이런 노드들은 하나씩 따로
// 펼치면 무한 재귀가 되므로, 한 상태 벡터로 묶어 같은 N개 시각에서 동시에 전진시킨다(식 길이 N배 유지).
// 반환: id 정렬 배열(자기 자신 포함). 길이 1이면 상호 피드백 없음(자기 피드백은 기존 처리).
function accFeedbackGroup(nodeId){
  const me = state.nodes[nodeId];
  if(!me || me.type!=='accumulate') return [nodeId];
  const loopSrc = id=>['in','reset'].map(k=>findWireInto(id,k)).filter(w=>w && state.nodes[w.from.node]).map(w=>w.from.node);
  const mySrc = loopSrc(nodeId);
  const group = [nodeId];
  Object.keys(state.nodes).forEach(id=>{
    if(id===nodeId) return;
    const m = state.nodes[id];
    if(!m || m.type!=='accumulate') return;
    if(mySrc.some(sid=>upstreamReaches(sid,id)) && loopSrc(id).some(sid=>upstreamReaches(sid,nodeId))) group.push(id);
  });
  return group.sort();
}

// [물리 수정] 상호 피드백 그룹의 갱신 순서(Gauss–Seidel / 심플렉틱 오일러).
// 기존에는 그룹 전원이 "직전 상태"만 읽는 야코비(= 전진 오일러) 방식이라, 위치-속도 진동계(중심력)에서
// 한 스텝마다 에너지가 (1+ω²dt²)배로 불어나 입자가 점점 바깥으로 발산했다(수치적으로 퍼짐).
// 속도를 먼저 갱신(kick)하고 갱신된 속도로 위치를 갱신(drift)하는 심플렉틱 오일러는 같은 비용으로 에너지가
// 유계로 유지된다(중심력 장에서 궤도가 발산하지 않음). 순서 판정: 다른 구성원의 출력을 "직접" 읽는 노드일수록
// (위치 ← 속도) 나중에, 힘 계산 같은 중간 노드를 거쳐 읽는 노드(속도 ← 힘(위치))일수록 먼저 갱신한다.
function accReadHops(id, groupIds){
  const srcs = ['in','reset'].map(k=>findWireInto(id,k)).filter(w=>w && state.nodes[w.from.node]).map(w=>w.from.node);
  let best = Infinity; const seen = new Set(); const q = srcs.map(n=>[n,0]);
  while(q.length){
    const [nid,dist] = q.shift();
    if(seen.has(nid)) continue; seen.add(nid);
    if(groupIds.includes(nid)){ if(nid!==id) best = Math.min(best,dist); continue; }
    const n = state.nodes[nid]; if(!n) continue;
    const def = NODE_DEFS[n.type];
    nodeAllInputs(n.type, n).forEach(sk=>{ const w=findWireInto(nid,sk.k); if(w && state.nodes[w.from.node]) q.push([w.from.node,dist+1]); });
  }
  return best;
}
function accOrderGroup(ids){
  const h = new Map(ids.map(i=>[i,accReadHops(i,ids)]));
  const key = i=>{ const v=h.get(i); return Number.isFinite(v)?v:1e9; };
  return [...ids].sort((a,b)=> (key(b)-key(a)) || (a<b?-1:a>b?1:0));
}

function safeIdTag(nodeId){
  // 노드 ID를 변수명에 안전하게 쓸 수 있는 고유 태그로 변환 (타입 프리픽스 포함 -> 노드간 충돌 방지)
  return nodeId.replace(/[^a-zA-Z0-9]/g,'');
}
// [v10] 변수 이름용 짧은 태그. Accumulate 적분은 상류 그래프를 스텝 수만큼 복사하므로 'wlmoGmo0accumulate23wall71_wall1_…' 같은
// 긴 이름이 식 길이를 3~4배로 부풀렸고, 55KB 상한에 걸려 samples(분할 수)가 경고 없이 32→3으로 깎였다.
// 노드 id 끝의 숫자(전역 고유)만 쓰는 짧은 태그로 바꾼다(이벤트 이름/identifier는 기존 safeIdTag 그대로).
function varTag(nodeId){
  const m = /_(\d+)$/.exec(nodeId);
  return m ? 'n'+m[1]+'_' : safeIdTag(nodeId);
}
let _ctxShortMap = new Map();
function shortCtx(tag){ if(!_ctxShortMap.has(tag)) _ctxShortMap.set(tag, _ctxShortMap.size.toString(36)); return _ctxShortMap.get(tag); }
// [v10] 적분 구간 분할. 상태 없는 Accumulate는 매 프레임 [0,T]를 N개로 나눠 처음부터 다시 적분하므로 스텝 길이가
// 나이에 비례해 커진다(15초·N=3이면 스텝 5초). 소용돌이·인력의 평형 위치 오차, 벽 반동으로 생기는 틈이 모두 "스텝 길이 × 힘"
// 크기라서 시간이 지날수록 입자가 풀려 나가고 인력점에 못 붙었다. auto는 경계를 b_k = 1-(1-k/N)^p 로 잡아
// 앞쪽은 크게, 끝쪽(지금 보이는 위치를 결정하는 구간)은 잘게 나눈다. p는 수명 Tmax에서 마지막 스텝이 약 1/30초 이하가 되도록
// 1~4 사이에서 고른다(균등 분할로 이미 충분히 촘촘하면 p=1 = 기존과 동일).
// [v10] 상수 계수 선형결합을 접어서 식 길이를 줄인다(0 항 생략, 1/−1 계수 생략). 예: lin([[0,'a'],[1,'b'],[-1,'c']]) → '(b-c)'
function lin(terms){
  const fmt = c=>pnum(c);
  let out = '';
  terms.forEach(([c,e])=>{ if(!c) return; const a=Math.abs(c), t = a===1 ? e : `${fmt(a)}*${e}`;
    out += out ? (c<0?'-':'+')+t : (c<0?'-':'')+t; });
  return out ? `(${out})` : '0.0';
}
function subC(e, c){ return c ? `(${e})-(${c})` : `(${e})`; }
// [v10.2] 벽 노드가 Accumulate 피드백 루프 안에 있는지: 벽 입력이 어떤 Accumulate 출력에서 오고, 벽 출력이 다시 그 Accumulate의 in/reset으로 들어가는지.
function wallInFeedback(wid){
  const ins = ['x','y','z'].map(k=>findWireInto(wid,k)).filter(Boolean).map(w=>w.from.node);
  if(!ins.length) return false;
  return Object.values(state.nodes).some(a=> a.type==='accumulate' && ins.some(sid=>upstreamReaches(sid,a.id))
    && ['in','reset'].some(k=>{ const w=findWireInto(a.id,k); return w && state.nodes[w.from.node] && upstreamReaches(w.from.node, wid); }));
}
// [v10.2] 1계 적분(힘→위치 직결)에서 Accumulate는 in 전체에 지수 보정 φ(hλ)를 곱한다(지수 오일러: 노이즈 같은 다른 힘도
// 인력과 같은 비율로 줄어야 평형 위치가 정확하다). 그런데 벽 보정 a+(b−c)/dt 는 "한 스텝에 b−c만큼 정확히 옮기기"라서 φ로 줄면
// 안 된다. 그래서 Formula의 dt를 실제로 곱해지는 길이 h·φ 로 넘긴다 → (b−c)/(hφ) × hφ = b−c 로 정확히 상쇄된다.
function effDtMolang(hd, lamList){
  if(!lamList.length) return hd;
  const z = `math.max(${hd}*(${lamList.join('+')}),0.0001)`;
  return `(${hd}*(1.0-math.exp(-${z}))/${z})`;
}
function accTmax(emitter){
  const em = emitter || Object.values(state.nodes).find(n=>n.type==='emitter');
  if(!em || !em.data) return 1;
  const d = em.data, life = Math.max(0.1, +d.lifetimeSeconds||1);
  return d.emitMode==='steady' ? life + Math.max(0.05, +d.particleLife||1) : life;
}
// [v10.5] 'auto' = 고정 시간 격자. 이전 auto(끝 쪽을 잘게)는 경계가 나이에 비례해 매 프레임 조금씩 움직여서, 같은 입자의 궤적을
// 프레임마다 다른 스텝으로 처음부터 다시 적분했다. 그 결과 벽을 따라 도는 입자의 위치(어느 면에 있는지)가 프레임마다 달라져
// 다른 면으로 순간이동했다. 고정 격자는 경계 g_k = k·H (H = 수명/N)가 시간에 따라 움직이지 않고, 지금 나이가 들어 있는 마지막 칸만
// 길이가 0→H로 자라므로 궤적이 시간에 대해 연속이다. 각 스텝 길이 = clamp(T − g_k, 0, H) (마지막 칸은 상한 없음).
function accSchedule(N, Tmax, mode){
  if(mode==='grid'){
    // [v10.6] 입자마다 격자를 0~H 만큼 어긋나게 둔다(첫 칸 길이 = 입자별 오프셋 o). 칸 경계에서는 힘을 새로 계산하므로 움직임 방향이
    // 살짝 꺾이는데, 모든 입자가 같은 격자를 쓰면 (한꺼번에 생성된 입자는 나이가 같아서) 같은 순간에 다 같이 꺾여 "움찔"했다.
    // 경계: s_0=0, s_k = o + (k−1)·H, 마지막 칸은 상한 없음. H = 수명/(N−1) 이라 수명 끝까지 덮는다.
    // 아주 짧은 칸(0.0001초 미만)은 0으로 둔다: 벽 보정 (b−c)/dt 의 dt는 0.0001 아래로 내려가지 않아서 일부만 적용됐다.
    const H = Math.max(1e-3, Tmax/Math.max(1,N-1)), fm = v=>pnum(v);
    const cut = v=> v<1e-4 ? 0 : v;
    const oJS = 0.5*H; // 노드 미리보기(입자 없음)용 오프셋
    const sJS = k=> k===0 ? 0 : oJS+(k-1)*H, lenJS = k=> k===0 ? oJS : H;
    const dtAt = (k,T)=> k===N-1 ? cut(Math.max(0, T-sJS(k))) : cut(Math.min(lenJS(k), Math.max(0, T-sJS(k))));
    const spanAt = (a,b,T)=> b>=N ? Math.max(0, T-sJS(a)) : Math.max(0, Math.min(sJS(b)-sJS(a), T-sJS(a)));
    const sch = { grid:true, H, dtAt, midAt:(k,T)=>sJS(k)+0.5*dtAt(k,T), spanAt, ov:'0.0' };
    const sM = k=> k===0 ? '0.0' : (k===1 ? sch.ov : `(${sch.ov}+${fm((k-1)*H)})`);
    const dM = (a,b)=> a===0 ? (b===1 ? sch.ov : `(${sch.ov}+${fm((b-1)*H)})`) : fm((b-a)*H); // s_b − s_a
    sch.initM = ()=> `${sch.ov}=${fm(H)}*math.mod(v.particle_random_1*12.9898+v.particle_random_2*78.233+v.particle_random_3*37.719,1.0);`;
    sch.dtS = (k,T,dtv)=> (k===N-1 ? `${dtv}=math.max(${T}-${sM(k)},0.0);` : `${dtv}=math.clamp(${T}-${sM(k)},0.0,${dM(k,k+1)});`) + `${dtv}=(${dtv}<0.0001)?0.0:${dtv};`;
    sch.midM = (k,dtv)=> k===0 ? `${dtv}*0.5` : `${sM(k)}+${dtv}*0.5`;
    sch.spanM = (a,b,T)=> b>=N ? `math.max(${T}-${sM(a)},0.0)` : `math.clamp(${T}-${sM(a)},0.0,${dM(a,b)})`;
    return sch;
  }
  let p = 1;
  if(mode!=='uniform' && N>1){ const need = Math.log(Math.max(1, Tmax*30))/Math.log(N); p = Math.max(1, Math.min(4, need)); }
  const b = []; for(let k=0;k<=N;k++) b.push(1-Math.pow(1-k/N, p));
  b[N] = 1;
  return { p, b, mid:k=>(b[k]+b[k+1])/2, w:k=>b[k+1]-b[k],
    dtAt:(k,T)=>T*(b[k+1]-b[k]), midAt:(k,T)=>T*(b[k]+b[k+1])/2, spanAt:(a,c,T)=>T*(b[c]-b[a]) };
}
// auto: 적분 루프 안에 6면 벽(피드백 벽)이 있으면 고정 격자(grid), 없으면 end(끝 쪽을 잘게 · v1.0.4와 같은 결과).
// 벽이 없으면 순간이동 문제가 없고 end가 더 정확하므로 그대로 둔다.
function accWallLoop(ids){
  return Object.values(state.nodes).some(n=>{
    if(n.type!=='wall') return false;
    const cm = (n.data&&n.data.collisionMode)||'auto';
    if(!(cm==='nearest' || (cm==='auto' && wallInFeedback(n.id)))) return false;
    return ['x','y','z'].some(k=>{ const w=findWireInto(n.id,k); return w && ids.includes(w.from.node); });
  });
}
function accModeOf(list, ids){
  const wl = list.some(x=>!x||x==='auto') && accWallLoop(ids||[]);
  const r = list.map(x=> (!x||x==='auto') ? (wl?'grid':'end') : x);
  return r.every(x=>x==='uniform') ? 'uniform' : r.some(x=>x==='grid') ? 'grid' : 'end';
}
// context: 'off'(offset, 파티클 생성 시 1회 평가 — 위치 계산 담당)
//          또는 'frame'(매 프레임 재평가 — size/tint(r/g/b/a) 계산. id를 역산해 필요한
//          상류 전체를 파티클마다 통째로 재계산하는 완전 분산형 경로).
// 두 컨텍스트는 실행 시점이 다르므로 변수 슬롯을 물리적으로 분리해 절대 값이 섞이지 않게 한다.
function varNameFor(nodeId, socketKey, context){
  let ctx = 'of';
  if(context==='frame') ctx = 'fr';
  else if(typeof context==='string' && context.indexOf('motion')===0) ctx = context.replace(/^motion/,'mo');
  return `v.${ctx}${varTag(nodeId)}_${socketKey}`;
}

// Emitter 노드의 출력 소켓(j,n,h,seed)은 creation_expression에서 세팅되는 실제 전역 변수를
// 그대로 가리켜야 한다. j는 offset 컨텍스트에서만 의미가 있는 누적 카운터이므로 frame 컨텍스트에서는
// 참조하지 않는다(색상이 더 이상 인덱스를 필요로 하지 않기 때문 — max_lifetime 디코딩으로 대체됨).
function emitterGlobalFor(socket, context){
  const isMotion = typeof context==='string' && context.indexOf('motion')===0;
  if(socket==='j') return isMotion ? 'v.fri' : 'v.j';
  if(socket==='n') return 'v.n';
  if(socket==='h') return 'v.h';
  if(socket==='seed') return 'v.seed';
  if(socket==='bone') return 'v.bone';
  return null;
}

// v5: rate_instant(1회 스폰) 전환으로 세대 순환(v.j 무한증가→리셋, sk 세대 플래그, rate_steady)이
// 완전히 사라졌다. 이제 파티클은 스폰 시 딱 한 번 v.i(0~n-1) 값을 부여받고, 그 값을 max_lifetime에
// 정수 그대로 저장해 두었다가 frame(매 프레임) 컨텍스트에서 비휘발성 소스(v.particle_lifetime)를
// 통해 그대로 복원한다. 그 뒤로는 offset과 동일한 수식들(Shape 좌표 계산 → Noise 3D 샘플링 좌표
// 변환 → 노이즈 계산, 그리고 v5에서 새로 추가된 linear_acceleration 힘 노드들)을 파티클 개개인이
// 처음부터 다시 실행한다. 슬롯 개수 제한은 없다 — id 하나만 있으면 노드가 몇 개든 각자 좌표를
// 복원해 알아서 재계산하기 때문이다.
//
// max_lifetime = 1000000 + id*100 + 99
//   - 1000000 : 자릿수 밀림 방지 베이스(디코딩 시 trunc(val/100)-10000으로 완전히 상쇄되어 사라짐)
//   - id*100  : 파티클의 고유 id(v.i, 0~n-1) — 정수 그대로, 정밀도 손실 없음
//   - 99      : 정수부 안전 마진용 고정 태그 — 유지(세대 플래그 sk는 v5에서 제거됨 —
//               더 이상 두 세대가 동시에 존재하지 않으므로 구분할 필요가 없다)
function idDecodeExpr(){
  return `(math.trunc(v.particle_lifetime/100)-10000)`;
}

// 노드의 특정 입력 소켓에 연결된 변수명을 반환. 미연결이면 fallback 반환.
// noise3d 자체는 여기서 특별 취급하지 않는다 — buildGraph가 컨텍스트별로 이 노드의 라인을
// 직접 생성해 두므로, resolveInput은 그냥 평소처럼 그 출력 변수명을 가리키면 된다
// (off에서는 1회 계산된 값, frame에서는 매 프레임 재계산된 값 — 같은 변수 이름 규칙, 다른 시점).
function resolveInput(nodeId, socketKey, fallback, context){
  const w = findWireInto(nodeId, socketKey);
  if(!w) return fallback;
  const fromNode = state.nodes[w.from.node];
  if(fromNode && (fromNode.type==='emitter' || fromNode.type==='sub_emitter')){
    const g = emitterGlobalFor(w.from.socket, context);
    if(g) return g;
  }
  return varNameFor(w.from.node, w.from.socket, context);
}

function buildGraph(context, emitter, outputNode, splitOpts, subOpts){
  // [v8-5] subOpts: Accumulate가 적분 구간 샘플마다 in/reset 상류만 따로 재컴파일할 때 쓰는 내부 옵션
  //   {roots:[시작 노드 id], selfId, chain:[...], bound}
  // context: 'off'   — offset: 파티클 생성 시 1회 실행. Output의 once 소켓(offset.x/y/z)
  //                    에서 역추적되는 모든 노드를 컴파일.
  //          'frame' — 매 프레임 tint/size를 위해 재실행.
  //          'motion0/motionP/motionM' — 같은 offset 그래프를 매 프레임 3개 시간 샘플로
  //                    재평가하여 2차 차분(linear_acceleration)하는 내부 컨텍스트. max_lifetime에서 id(v.fri)를 비휘발성으로
  //                    복원한 뒤, Output의 perframe 소켓(size/tint r/g/b/a)에서 역추적되는 모든 노드를
  //                    처음부터 다시 컴파일한다 — noise3d를 포함해 그 상류(Shape 등)까지 전부
  //                    "완전 분산형"으로 파티클 개개인이 통째로 재계산한다.
  // emitter/outputNode: 이 그래프가 소속된 (Sub)Emitter와 그에 연결된 Output 노드.
  // 하나의 캔버스에 여러 (Sub)Emitter + Output 쌍이 있을 수 있으므로, 각 쌍은 서로 완전히
  // 독립된 파티클 JSON으로 컴파일된다(변수 슬롯도 겹치지 않음 — 각자 자기 노드 id로 네이밍).
  const errors = [];

  // splitOpts: 1000개 초과 count를 여러 "분산 이미터" 파일로 자동 분할할 때 쓰는 옵션.
  //   localCount : 이 파일이 실제로 스폰하는 개수(최대 1000). v.n(=emitJ의 분모, num_particles 등)에 쓰임.
  //   globalN    : 나선/도형 수식의 분모로 쓸 "전체" 개수(전 분산 파일 합계). shape 프리셋의 n 그대로.
  //   jOffset    : 이 파일의 로컬 인덱스(0~localCount-1)에 더해서 전역 나선 인덱스로 만드는 오프셋.
  // splitOpts가 없으면(단일 파일) localCount===globalN, jOffset=0으로 기존과 동일하게 동작한다.
  const rawCount = Math.max(1, Math.round(emitter.data.count||1));
  const localCount = splitOpts ? splitOpts.localCount : Math.min(1000, rawCount);
  const globalN = splitOpts ? splitOpts.globalN : localCount;
  const jOffset = splitOpts ? splitOpts.jOffset : 0;
  const count = localCount;
  const outputs = [outputNode];

  // 위상 정렬: output에서 역방향 BFS로 필요한 노드만 수집.
  // 완전 분산형에서는 noise3d도 다른 노드와 동일하게 취급한다 — 어느 컨텍스트에서 필요하면
  // (off든 frame이든) 그 컨텍스트에서 x/y/z/seed 입력의 상류(Shape 등)까지 전부 역추적해서
  // 함께 컴파일한다. 즉 "노이즈 출력에서 역추적되는 모든 노드가 자동으로 같은 컨텍스트로
  // 끌려온다"는 요청 그대로: off에서 필요하면 그 상류는 off 라인으로, frame에서 필요하면
  // 그 상류는 frame 라인으로(=파티클마다 매 프레임 좌표 계산부터 통째로 재실행) 생성된다.
  // output 소켓의 timing(once/perframe)으로 각 컨텍스트가 어느 소켓에서 출발할지만 가른다.
  const needed = new Set();
  const queue = [];
  if(subOpts) subOpts.roots.forEach(r=>queue.push(r));
  (subOpts?[]:outputs).forEach(n=>{
    const def = NODE_DEFS[n.type];
    def.inputs.forEach(s=>{
      const sTiming = s.timing || 'once';
      const isMotionContext = typeof context==='string' && context.indexOf('motion')===0;
      const matches = context==='off' ? sTiming==='once'
        : isMotionContext ? ((sTiming==='once' && s.k!=='rot') || sTiming==='motion')
        : sTiming==='perframe';
      if(!matches) return;
      const w = findWireInto(n.id, s.k);
      if(w && state.nodes[w.from.node]) queue.push(w.from.node);
    });
  });
  while(queue.length){
    const nid = queue.shift();
    if(needed.has(nid)) continue;
    needed.add(nid);
    const n = state.nodes[nid];
    if(!n) continue;
    if(subOpts && (subOpts.selfIds||[subOpts.selfId]).includes(nid)) continue;
    if(n.type==='accumulate'){ // [v8-5-4] 상호 피드백 그룹은 한 덩어리로 컴파일하므로 전원을 필요 노드에 포함(각자의 init 상류도 함께 끌려옴)
      accFeedbackGroup(nid).forEach(g=>{ if(!needed.has(g) && state.nodes[g]) queue.push(g); });
    }
    const def = NODE_DEFS[n.type];
    nodeAllInputs(n.type, n).forEach(s=>{
      if(n.type==='accumulate' && (s.k==='in'||s.k==='reset'||s.k==='rate')) return; // [v8-5] 이 상류는 Accumulate가 샘플별로 따로 컴파일
      const w = findWireInto(n.id, s.k);
      if(w && state.nodes[w.from.node]) queue.push(w.from.node);
    });
  }

  // 토폴로지 순서 계산 (emitter가 항상 먼저)
  const order = [];
  const visited = new Set();
  function visit(n){
    if(visited.has(n.id)) return;
    if(n.type==='accumulate'){
      // [v8-5-4] 상호 피드백 그룹: 모든 구성원의 (피드백이 아닌) 입력 상류를 먼저 방문한 뒤 구성원을 연달아 배치.
      const grp = accFeedbackGroup(n.id).filter(id=>state.nodes[id] && needed.has(id));
      if(grp.length>1){
        grp.forEach(id=>visited.add(id));
        grp.forEach(id=>{
          const m = state.nodes[id];
          nodeAllInputs(m.type, m).forEach(sk=>{
            if(isFeedbackWire(id, sk.k)) return;
            const w = findWireInto(id, sk.k);
            if(w && state.nodes[w.from.node] && needed.has(w.from.node) && !grp.includes(w.from.node)) visit(state.nodes[w.from.node]);
          });
        });
        grp.forEach(id=>order.push(state.nodes[id]));
        return;
      }
    }
    visited.add(n.id);
    const def = NODE_DEFS[n.type];
    nodeAllInputs(n.type, n).forEach(s=>{
      const w = findWireInto(n.id, s.k);
      if(isFeedbackWire(n.id, s.k)) return; // [v8-2-4] 피드백 간선은 정렬에서 제외(이전 프레임 값을 읽음)
      if(w && state.nodes[w.from.node] && needed.has(w.from.node)) visit(state.nodes[w.from.node]);
    });
    order.push(n);
  }
  needed.forEach(id=>{ if(state.nodes[id]) visit(state.nodes[id]); });

  // n, h, seed는 두 컨텍스트가 공유해도 안전(생성 시 1회만 세팅되고 이후 불변).
  // j는 offset 전용 휘발성 누적 카운터. v.j는 0~2n-1 범위로 두 세대(현재+직전)를 순환하는
  // 세대 카운터이므로, 나선/도형 좌표 계산에는 v.j를 그대로 쓰면 안 되고 0~n-1로 접은
  // v.i(나선 전용 인덱스, 원본 예제와 동일 역할)를 써야 한다.
  // frame 컨텍스트에서는 v.j 같은 휘발성 카운터가 없다 — 대신 max_lifetime에 저장해 둔
  // id(비휘발성)를 역산한 뒤 그 값을 0~n-1로 접어서 동일한 v.i 역할을 하게 만든다.
  const ctxTag = context==='frame' ? 'fr'
    : (typeof context==='string' && context.indexOf('motion')===0 ? context.replace(/^motion/,'mo') : 'of');
  // 분산 이미터 지원: shape 등 나선/도형 수식이 참조하는 j/n은 "로컬 스폰 인덱스/개수"가 아니라
  // "전역(=전 분산 파일 합계) 나선 인덱스/개수"여야 여러 파일에 걸쳐 하나로 이어진 도형이 된다.
  // splitOpts가 없으면 jOffset=0, globalN=localCount이므로 기존과 완전히 동일하게 동작한다.
  const localJ = context==='off' ? 'v.i' : 'v.fri';
  const emitJ = jOffset ? `(${localJ}+${jOffset})` : localJ;
  const emitN = splitOpts ? String(globalN) : 'v.n';
  const emitH = 'v.h', emitSeed = 'v.seed';

  // 각 노드별 Molang 라인 생성
  const lines = [];
  if(!subOpts && (context==='frame' || (typeof context==='string' && context.indexOf('motion')===0)) && needed.size){
    // frame/motion 모두 파티클 고유 id를 복원한다. motion에서 v.fri가 없으면
    // Shape/Noise가 잘못된 공통 인덱스를 사용해 파티클별 궤적이 깨진다.
    lines.push(`v.fri=${idDecodeExpr()};`);
  }

  const emittedAccGroups = new Set(); // [v8-5-4] 이미 합동 적분 블록을 낸 Accumulate 그룹
  order.forEach(node=>{
    if(node.type==='emitter' || node.type==='sub_emitter') return; // emitter 자체 값은 creation_expression에서 세팅

    if(node.type==='shape'){
      let ex, ey, ez;
      // r1/r2/rs 전용 슬롯 없음 — Shape는 항상 exprX/Y/Z 커스텀 수식(j,n,h,seed만 변수로 허용)이다.
      // 프리셋을 불러오면 그 프리셋의 반지름류 값이 이미 숫자 리터럴로 치환되어 이 문자열
      // 안에 들어있으므로, 컴파일러 입장에서는 그냥 평범한 수식일 뿐이다.
      const varMap = { j:emitJ, n:emitN, h:emitH, seed:emitSeed };
      try{
        ex = compileFormula(node.data.exprX||'0', varMap);
        ey = compileFormula(node.data.exprY||'0', varMap);
        ez = compileFormula(node.data.exprZ||'0', varMap);
      }catch(err){ errors.push(`Shape 노드(${node.id}) 수식 오류: ${err.message}`); return; }
      const vx=varNameFor(node.id,'x',context), vy=varNameFor(node.id,'y',context), vz=varNameFor(node.id,'z',context);
      lines.push(`${vx}=${ex};${vy}=${ey};${vz}=${ez};`);
    }

    if(node.type==='shape_image_contour'){
      // EFD 삼각함수 합은 한 줄에 전부 인라인하지 않는다.
      // 기본 2 harmonic 단위로 잘라 각각 별도 Molang 문장으로 누적한다.
      // 예:
      //   v.of..._x = (H1~H8);
      //   v.of..._x = v.of..._x + (H9~H16);
      // 이렇게 하면 각 파싱 단위의 중첩 깊이가 "8 harmonic 분량"으로 제한된다.
      if(!node.data.efdList || !node.data.efdList.length){
        errors.push(`Shape (Image Contour) 노드(${node.id})에 베이크된 외곽선 데이터가 없습니다. 이미지를 업로드하세요.`);
        return;
      }

      const gen = efdToShapeExprSegments(node.data.efdList, {
        scale: node.data.xzScale!==undefined?node.data.xzScale:2,
        flipY: node.data.flipY!==false,
        rotateOffsetDeg: node.data.rotateOffsetDeg||0,
        res: (node.data.tracedPreview && node.data.tracedPreview.res) || node.data.traceResolution || 128,
        chunkHarmonics: 2,
        // Keep EFD segmentation on exactly the same global index space as the
        // Shape compiler. This is essential when an emitter is split into 1000-particle files.
        jExpr: emitJ,
        nExpr: emitN,
        prefix: `ec${ctxTag}${varTag(node.id)}` ,
      });

      const varMap = { j:emitJ, n:emitN, h:emitH, seed:emitSeed };
      const vx=varNameFor(node.id,'x',context);
      const vy=varNameFor(node.id,'y',context);
      const vz=varNameFor(node.id,'z',context);

      try{
        // mask/localT는 Fourier 항 안에 인라인하지 않고 먼저 한 번만 계산한다.
        // 따라서 각 harmonic 문장은 매우 얕은 Molang 식만 파싱한다.
        gen.setupLines.forEach(line=>lines.push(line));

        // x: 첫 구간을 직접 대입하고 이후 구간은 기존 값에 누적.
        gen.xSegments.forEach((seg, i)=>{
          const compiled = compileFormula(seg, varMap);
          if(i===0) lines.push(`${vx}=${compiled};`);
          else lines.push(`${vx}=${vx}+(${compiled});`);
        });

        // z: x와 동일하게 harmonic 구간별 누적.
        gen.zSegments.forEach((seg, i)=>{
          const compiled = compileFormula(seg, varMap);
          if(i===0) lines.push(`${vz}=${compiled};`);
          else lines.push(`${vz}=${vz}+(${compiled});`);
        });

        // y는 기존처럼 단일 수식으로 평가한다.
        const ey = compileFormula(node.data.yExpr||'0', varMap);
        lines.push(`${vy}=${ey};`);
      }catch(err){
        errors.push(`Shape (Image Contour) 노드(${node.id}) 수식 오류: ${err.message}`);
        return;
      }
    }

    if(node.type==='noise3d'){
      // 완전 분산형 3D 노이즈. 노이즈 샘플링 좌표(px/py/pz) 자체는 off/frame 각 컨텍스트에서
      // 독립적으로 계산된다(입력 x/y/z가 컨텍스트별로 다른 상류에서 올 수 있으므로).
      // 회전각/순환오프셋 진행량은 세대(파티클 묶음) 단위 계단식 누적이 아니라, v.emitter_age
      // (이미터가 켜진 뒤 계속 흐르는 초 단위 전역 시간) 기반이다 — rotAcc = v.emitter_age *
      // rotateStep * speed, cox/coy/coz도 동일 패턴. v.particle_age(파티클 개별 생존 시간)가
      // 아니라 v.emitter_age를 쓰는 이유: 이 파이프라인은 파티클이 매우 빠르게 재생성·소멸되는
      // 순환 구조라, particle_age를 쓰면 파티클이 교체될 때마다 회전값이 0으로 리셋돼 버벅이는
      // 것처럼 보인다. emitter_age는 파티클 교체와 무관하게 전역적으로 계속 흐르므로 매 프레임
      // 완전히 매끄럽게 이어진다. off(생성 시 1회 계산)와 frame(매 프레임 재계산되는 tint/size)
      // 양쪽 모두 같은 v.emitter_age 시점을 참조하므로 두 컨텍스트 사이에서도 값이 어긋나지
      // 않는다. 세대 카운터(v.j)나 emitter 레벨 누적 변수(accumLines/creation 초기화)에는
      // 더 이상 의존하지 않는다.
      const inX = resolveInput(node.id,'x','0',context);
      const inY = resolveInput(node.id,'y','0',context);
      const inZ = resolveInput(node.id,'z','0',context);
      const inSeed = resolveInput(node.id,'seed', String(node.data.seed), context);
      const tag = ctxTag+varTag(node.id);
      // scale/amplitude: 입력 소켓에 연결돼 있으면 그 상류 수식을 그대로 쓰고, 미연결이면
      // 숫자 필드를 리터럴로 쓴다(speed와 동일한 폴백 패턴). NaN/빈 값은 "값 없음"에 해당하는
      // 안전한 기본값(scale=0.5, amplitude=1)으로 폴백해 노이즈가 아예 죽어버리는 것을 방지한다.
      const scaleFallback = (node.data.scale===undefined || node.data.scale===null || isNaN(node.data.scale)) ? 0.5 : node.data.scale;
      const ampFallback = (node.data.amplitude===undefined || node.data.amplitude===null || isNaN(node.data.amplitude)) ? 1 : node.data.amplitude;
      const scale = resolveInput(node.id,'scale', String(scaleFallback), context);
      const amp = resolveInput(node.id,'amplitude', String(ampFallback), context);
      // speed: rotateStep/cycleOffsetStep에 곱해지는 진행 속도 배수. speed 입력 소켓이 연결돼
      // 있으면 그 상류 노드의 출력을(이 컨텍스트에서 컴파일된 변수명으로) 그대로 배수로 쓰고,
      // 미연결이면 숫자 필드(node.data.speed)를 리터럴로 쓴다 — 노이즈 노드마다 서로 다른
      // 속도(또는 속도 수식)를 자유롭게 줄 수 있다. 필드가 비어있거나 NaN이면(모바일에서 값을
      // 지우는 도중 등) "변화 없음"에 해당하는 배속 1로 안전하게 폴백한다 — 0이 되면 회전/
      // 오프셋이 완전히 멈춰버려 의도치 않게 노이즈가 얼어붙어 보이기 때문이다.
      const speedFallback = (node.data.speed===undefined || node.data.speed===null || isNaN(node.data.speed)) ? 1 : node.data.speed;
      const speedExpr = resolveInput(node.id,'speed', String(speedFallback), context);
      let px=`v.nz${tag}px`, py=`v.nz${tag}py`, pz=`v.nz${tag}pz`;
      lines.push(`${px}=(${inX})*(${scale});${py}=(${inY})*(${scale});${pz}=(${inZ})*(${scale});`);

      if(node.data.cycleOffsetEnabled){
        const cox = `v.nz${tag}cox`, coy = `v.nz${tag}coy`, coz = `v.nz${tag}coz`;
        const stepX = PV(node,'cycleOffsetStepX',node.data.cycleOffsetStepX||0,context), stepY = PV(node,'cycleOffsetStepY',node.data.cycleOffsetStepY||0,context), stepZ = PV(node,'cycleOffsetStepZ',node.data.cycleOffsetStepZ||0,context);
        lines.push(`${cox}=v.emitter_age*(${stepX})*(${speedExpr});${coy}=v.emitter_age*(${stepY})*(${speedExpr});${coz}=v.emitter_age*(${stepZ})*(${speedExpr});`);
        lines.push(`${px}=${px}+${cox};${py}=${py}+${coy};${pz}=${pz}+${coz};`);
      }

      if(node.data.rotateEnabled){
        // 회전축은 기본 Y축(0,1,0)을 tiltX(X축 기준 기울기) → tiltY(Y축 기준 기울기) 순으로 틀어서 결정하고,
        // 그 축을 중심으로 Rodrigues 회전 공식을 적용한다(임의 축 3D 회전, 축이 정확히 Y축이면 기존 X/Z 평면 회전과 동일).
        const rotAcc = `v.nz${tag}racc`, rot=`v.nz${tag}ry`, cs=`v.nz${tag}cs`, sn=`v.nz${tag}sn`;
        const tiltX = PV(node,'tiltX',node.data.tiltX||0,context), tiltY = PV(node,'tiltY',node.data.tiltY||0,context); // 연결되면 문자열 → 일반 축 회전 경로
        const rotateStep = PV(node,'rotateStep',node.data.rotateStep!==undefined?node.data.rotateStep:6,context);
        lines.push(`${rotAcc}=v.emitter_age*(${rotateStep})*(${speedExpr});`);
        lines.push(`${rot}=${rotAcc};${cs}=math.cos(${rot});${sn}=math.sin(${rot});`);

        if(tiltX===0 && tiltY===0){
          // 축이 정확히 Y축(0,1,0)인 특수 케이스: 기존과 동일한 단순 X/Z 평면 회전으로 축소(연산량 절약).
          const rpx=`v.nz${tag}rpx`, rpz=`v.nz${tag}rpz`;
          lines.push(`${rpx}=${px}*${cs}-${pz}*${sn};${rpz}=${px}*${sn}+${pz}*${cs};`);
          lines.push(`${px}=${rpx};${pz}=${rpz};`);
        } else {
          if(typeof tiltX==='string' || typeof tiltY==='string'){
            // [자세히 설정] 기울기가 연결된 경우: 실행 중 값이 둘 다 0이면 위의 단순 경로와 똑같은 결과가 나오도록
            // 회전 방향 부호를 맞춘다(단순 경로는 일반 경로와 축 (0,1,0)에서 회전 방향이 반대라서).
            lines.push(`${sn}=${sn}*((((${tiltX})==0)&&((${tiltY})==0))?-1:1);`);
          }
          // 임의 축 회전: 축 벡터(ax,ay,az)는 기울기 각도가 고정값이므로 파티클마다 동일 — 매번 재계산해도
          // 상수 취급되어 비용은 미미하다(향후 노드 입력으로 동적화할 수 있도록 이 자리에서 계산).
          const ax=`v.nz${tag}ax`, ay=`v.nz${tag}ay`, az=`v.nz${tag}az`;
          // 기본축 (0,1,0)을 X축 기준 tiltX만큼, 그다음 Y축 기준 tiltY만큼 회전해서 최종 축을 구한다.
          lines.push(`${ax}=math.sin(${tiltY})*math.cos(${tiltX});${ay}=math.cos(${tiltY})*math.cos(${tiltX});${az}=math.sin(${tiltX});`);
          const dot=`v.nz${tag}adot`;
          lines.push(`${dot}=${ax}*${px}+${ay}*${py}+${az}*${pz};`);
          const rpx=`v.nz${tag}rpx`, rpy=`v.nz${tag}rpy`, rpz=`v.nz${tag}rpz`;
          lines.push(`${rpx}=${px}*${cs}+(${ay}*${pz}-${az}*${py})*${sn}+${ax}*${dot}*(1.0-${cs});`);
          lines.push(`${rpy}=${py}*${cs}+(${az}*${px}-${ax}*${pz})*${sn}+${ay}*${dot}*(1.0-${cs});`);
          lines.push(`${rpz}=${pz}*${cs}+(${ax}*${py}-${ay}*${px})*${sn}+${az}*${dot}*(1.0-${cs});`);
          lines.push(`${px}=${rpx};${py}=${rpy};${pz}=${rpz};`);
        }
      }

      // px/py/pz는 순수하게 노이즈 "샘플링 좌표"다(회전/순환오프셋이 적용된 내부 계산용).
      // off에서 이 노드의 n을 offset.x/y/z에 연결하지 않는 한 파티클 실제 위치에는 반영되지 않는다.
      // noiseType에 따라 서로 다른 Molang 노이즈 함수를 호출한다(전부 순수 수식, 텍스처 샘플링
      // 없이 Bedrock Molang 안에서 절차적으로 계산 — Unity VFX Graph/Houdini의 각 노이즈 노드가
      // 만드는 결과와 같은 계열의 패턴을 낸다).
      const noiseType = node.data.noiseType || 'perlin';
      let noiseVar;
      if(noiseType==='simplex'){
        lines.push(simplexNoiseMolang(px,py,pz,inSeed,`nzr${tag}`));
        noiseVar = `v.nzr${tag}noise`;
      } else if(noiseType==='voronoi'){
        const density = node.data.cellDensity!==undefined?node.data.cellDensity:2;
        const smooth = node.data.voronoiSmooth||0;
        lines.push(voronoiNoiseMolang(px,py,pz,inSeed,`nzr${tag}`,density,smooth));
        noiseVar = `v.nzr${tag}noise`;
      } else if(noiseType==='fbm'){
        const octaves = Math.max(1, Math.min(8, Math.round(node.data.octaves!==undefined?node.data.octaves:3)));
        const lacunarity = node.data.lacunarity!==undefined?node.data.lacunarity:2;
        const gain = node.data.gain!==undefined?node.data.gain:0.5;
        lines.push(fbmNoiseMolang(px,py,pz,inSeed,`nzr${tag}`,octaves,lacunarity,gain));
        noiseVar = `v.nzr${tag}noise`;
      } else {
        lines.push(perlinNoiseMolang(px,py,pz,inSeed,`nzr${tag}`));
        noiseVar = `v.nzr${tag}noise`;
      }
      const ampliVar = `v.nz${tag}namp`;
      lines.push(`${ampliVar}=${noiseVar}*(${amp});`);
      const nOutVar = varNameFor(node.id,'n',context);
      // 위치/모션 경로에서만 Noise 단일 축 기여를 -1..1로 제한한다.
      // tint/size 같은 일반 frame 출력의 Noise amplitude 동작은 그대로 보존한다.
      const boundNoise = (subOpts&&subOpts.bound) || context==='off' || context==='motion0' || context==='motionP' || context==='motionM';
      lines.push(`${nOutVar}=${boundNoise ? `math.clamp(${ampliVar},-1.0,1.0)` : ampliVar};`);
    }

    if(node.type==='curlnoise'){
      // Curl noise: perlinNoiseMolang을 6번(±eps씩 x/y/z 방향으로 살짝 어긋난 좌표) 호출해
      // 유한차분으로 회전을 구한다. 발산이 0이 되므로(비압축) 힘으로 써도 파티클이 한 점에
      // 뭉치지 않고 소용돌이치듯 흐른다(Unity VFX Graph "Perlin Curl Noise" Operator와 동일 개념).
      const inX = resolveInput(node.id,'x','0',context);
      const inY = resolveInput(node.id,'y','0',context);
      const inZ = resolveInput(node.id,'z','0',context);
      const inSeed = resolveInput(node.id,'seed', String(node.data.seed), context);
      const tag = ctxTag+varTag(node.id);
      const scaleFallback = (node.data.scale===undefined || node.data.scale===null || isNaN(node.data.scale)) ? 0.5 : node.data.scale;
      const ampFallback = (node.data.amplitude===undefined || node.data.amplitude===null || isNaN(node.data.amplitude)) ? 1 : node.data.amplitude;
      const scale = resolveInput(node.id,'scale', String(scaleFallback), context);
      const amp = resolveInput(node.id,'amplitude', String(ampFallback), context);
      const px=`v.cn${tag}px`, py=`v.cn${tag}py`, pz=`v.cn${tag}pz`;
      lines.push(`${px}=(${inX})*(${scale});${py}=(${inY})*(${scale});${pz}=(${inZ})*(${scale});`);
      if(node.data.flowEnabled){
        // z 좌표에 시간 기반 오프셋을 더해 3D 노이즈 패턴을 그 축 방향으로 흘려보낸다.
        // Unity VFX Graph "Curl Noise"의 Time 입력과 동일한 역할.
        const fSpeed = node.data.flowSpeed!==undefined?node.data.flowSpeed:0.2;
        const fAge = node.data.flowTimeSource==='particle_age' ? 'v.particle_age' : 'v.emitter_age';
        lines.push(`${pz}=${pz}+${fAge}*(${fSpeed});`);
      }
      const eps = 0.08;
      // [BUGFIX] curl(Ψ) = (dΨz/dy - dΨy/dz, dΨx/dz - dΨz/dx, dΨy/dx - dΨx/dy) 를 구하려면
      // 성분(Ψx/Ψy/Ψz, seed+0/+10/+20)마다 서로 다른 두 축 방향의 편미분이 각각 필요하다 —
      // 즉 6개가 아니라 12개의 오프셋 샘플(성분 3개 × 이동축 2개 × ±eps)이 필요하다.
      // 이전 버전은 "이동축" 기준으로만 6개 샘플을 뽑아 재사용했는데, 그 결과 예를 들어 fy 계산에
      // (xp-xn)을 dΨx/dz 대신 써버리는 등 성분과 축이 뒤섞였다 — 이는 순수 JS의 curlNoise3D와
      // 다른 수식이 되어(z 성분 정보가 x/y축 이동값으로 잘못 대체됨) 3D 벡터장이 특정 평면으로
      // 눌리는(flatten) 아티팩트를 일으켰다. 아래는 순수 JS curlNoise3D와 동일하도록 12개로 수정.
      const samples = [
        ['zy_p', px, `${py}+${eps}`, pz, 20], ['zy_n', px, `${py}-${eps}`, pz, 20], // dΨz/dy
        ['yz_p', px, py, `${pz}+${eps}`, 10], ['yz_n', px, py, `${pz}-${eps}`, 10], // dΨy/dz
        ['xz_p', px, py, `${pz}+${eps}`, 0],  ['xz_n', px, py, `${pz}-${eps}`, 0],  // dΨx/dz
        ['zx_p', `${px}+${eps}`, py, pz, 20], ['zx_n', `${px}-${eps}`, py, pz, 20], // dΨz/dx
        ['yx_p', `${px}+${eps}`, py, pz, 10], ['yx_n', `${px}-${eps}`, py, pz, 10], // dΨy/dx
        ['xy_p', px, `${py}+${eps}`, pz, 0],  ['xy_n', px, `${py}-${eps}`, pz, 0],  // dΨx/dy
      ];
      samples.forEach(([suf,sx,sy,sz,seedOff])=>{
        lines.push(perlinNoiseMolang(sx,sy,sz,`(${inSeed}+${seedOff})`,`cn${tag}${suf}`));
      });
      const g=(suf)=>`v.cn${tag}${suf}noise`;
      const twoEps = (2.0*eps);
      lines.push(`v.cn${tag}fx=((${g('zy_p')}-${g('zy_n')})/${twoEps})-((${g('yz_p')}-${g('yz_n')})/${twoEps});`);
      lines.push(`v.cn${tag}fy=((${g('xz_p')}-${g('xz_n')})/${twoEps})-((${g('zx_p')}-${g('zx_n')})/${twoEps});`);
      lines.push(`v.cn${tag}fz=((${g('yx_p')}-${g('yx_n')})/${twoEps})-((${g('xy_p')}-${g('xy_n')})/${twoEps});`);
      lines.push(`${varNameFor(node.id,'fx',context)}=v.cn${tag}fx*(${amp});`);
      lines.push(`${varNameFor(node.id,'fy',context)}=v.cn${tag}fy*(${amp});`);
      lines.push(`${varNameFor(node.id,'fz',context)}=v.cn${tag}fz*(${amp});`);
    }

    if(node.type==='curlturb'){
      // Turbulence(다중 옥타브 Curl Noise): curlnoise 블록(perlin 6회 유한차분)을 octaves번
      // 반복하되, 매 옥타브마다 좌표 스케일은 lacunarity배, 기여도는 gain배로 조정한 뒤
      // 가중평균한다 — fbmNoiseMolang이 perlinNoiseMolang을 겹치는 것과 완전히 동일한 패턴을
      // curl(6-샘플 유한차분)에 적용한 형태.
      const inX = resolveInput(node.id,'x','0',context);
      const inY = resolveInput(node.id,'y','0',context);
      const inZ = resolveInput(node.id,'z','0',context);
      const inSeed = resolveInput(node.id,'seed', String(node.data.seed), context);
      const tag = ctxTag+varTag(node.id);
      const scaleFallback = (node.data.scale===undefined || node.data.scale===null || isNaN(node.data.scale)) ? 0.5 : node.data.scale;
      const ampFallback = (node.data.amplitude===undefined || node.data.amplitude===null || isNaN(node.data.amplitude)) ? 1 : node.data.amplitude;
      const scale = resolveInput(node.id,'scale', String(scaleFallback), context);
      const amp = resolveInput(node.id,'amplitude', String(ampFallback), context);
      const octaves = Math.max(1, Math.min(6, Math.round(node.data.octaves!==undefined?node.data.octaves:3)));
      const lacunarity = node.data.lacunarity!==undefined?node.data.lacunarity:2;
      const gain = node.data.gain!==undefined?node.data.gain:0.5;
      const eps = 0.08;
      const twoEps = (2.0*eps);
      const bpx=`v.ct${tag}px`, bpy=`v.ct${tag}py`, bpz=`v.ct${tag}pz`;
      lines.push(`${bpx}=(${inX})*(${scale});${bpy}=(${inY})*(${scale});${bpz}=(${inZ})*(${scale});`);
      if(node.data.flowEnabled){
        const fSpeed = node.data.flowSpeed!==undefined?node.data.flowSpeed:0.2;
        const fAge = node.data.flowTimeSource==='particle_age' ? 'v.particle_age' : 'v.emitter_age';
        lines.push(`${bpz}=${bpz}+${fAge}*(${fSpeed});`);
      }
      lines.push(`v.ct${tag}famp=1.0;v.ct${tag}ffreq=1.0;v.ct${tag}sumx=0.0;v.ct${tag}sumy=0.0;v.ct${tag}sumz=0.0;v.ct${tag}norm=0.0;`);
      for(let o=0; o<octaves; o++){
        const otag = `${tag}o${o}`;
        const px=`v.ct${otag}px`, py=`v.ct${otag}py`, pz=`v.ct${otag}pz`;
        lines.push(`${px}=${bpx}*v.ct${tag}ffreq;${py}=${bpy}*v.ct${tag}ffreq;${pz}=${bpz}*v.ct${tag}ffreq;`);
        const octSeed = `(${inSeed}+${o*11}.0)`;
        // [BUGFIX] curlnoise와 동일한 이유로 6개가 아닌 12개 샘플(성분×이동축)이 필요하다 — 자세한
        // 설명은 curlnoise export 블록의 주석 참고.
        const samples = [
          ['zy_p', px, `${py}+${eps}`, pz, 20], ['zy_n', px, `${py}-${eps}`, pz, 20],
          ['yz_p', px, py, `${pz}+${eps}`, 10], ['yz_n', px, py, `${pz}-${eps}`, 10],
          ['xz_p', px, py, `${pz}+${eps}`, 0],  ['xz_n', px, py, `${pz}-${eps}`, 0],
          ['zx_p', `${px}+${eps}`, py, pz, 20], ['zx_n', `${px}-${eps}`, py, pz, 20],
          ['yx_p', `${px}+${eps}`, py, pz, 10], ['yx_n', `${px}-${eps}`, py, pz, 10],
          ['xy_p', px, `${py}+${eps}`, pz, 0],  ['xy_n', px, `${py}-${eps}`, pz, 0],
        ];
        samples.forEach(([suf,sx,sy,sz,seedOff])=>{
          lines.push(perlinNoiseMolang(sx,sy,sz,`(${octSeed}+${seedOff})`,`ct${otag}${suf}`));
        });
        const g=(suf)=>`v.ct${otag}${suf}noise`;
        lines.push(`v.ct${otag}fx=((${g('zy_p')}-${g('zy_n')})/${twoEps})-((${g('yz_p')}-${g('yz_n')})/${twoEps});`);
        lines.push(`v.ct${otag}fy=((${g('xz_p')}-${g('xz_n')})/${twoEps})-((${g('zx_p')}-${g('zx_n')})/${twoEps});`);
        lines.push(`v.ct${otag}fz=((${g('yx_p')}-${g('yx_n')})/${twoEps})-((${g('xy_p')}-${g('xy_n')})/${twoEps});`);
        lines.push(`v.ct${tag}sumx=v.ct${tag}sumx+v.ct${otag}fx*v.ct${tag}famp;v.ct${tag}sumy=v.ct${tag}sumy+v.ct${otag}fy*v.ct${tag}famp;v.ct${tag}sumz=v.ct${tag}sumz+v.ct${otag}fz*v.ct${tag}famp;`);
        lines.push(`v.ct${tag}norm=v.ct${tag}norm+v.ct${tag}famp;`);
        lines.push(`v.ct${tag}famp=v.ct${tag}famp*${gain};v.ct${tag}ffreq=v.ct${tag}ffreq*${lacunarity};`);
      }
      lines.push(`${varNameFor(node.id,'fx',context)}=(v.ct${tag}norm>0.0?v.ct${tag}sumx/v.ct${tag}norm:0.0)*(${amp});`);
      lines.push(`${varNameFor(node.id,'fy',context)}=(v.ct${tag}norm>0.0?v.ct${tag}sumy/v.ct${tag}norm:0.0)*(${amp});`);
      lines.push(`${varNameFor(node.id,'fz',context)}=(v.ct${tag}norm>0.0?v.ct${tag}sumz/v.ct${tag}norm:0.0)*(${amp});`);
    }

    if(node.type==='vortexfield'){
      // 흐름 속도장 u(축 둘레 회전 + 반경 방향 유입, Rankine/Lamb–Oseen 코어)에 입자를 점성 결합하고,
      // 흐름과 함께 도는 입자에 필요한 구심 가속 a_c를 더한다(JS vortexFieldForce와 동일 공식):
      //   w = (1−r/R)^falloff,  den = √(r²+rc²),  sw = strength·w
      //   u = sw·[(axis×r) − pull·r]/den,   F = k·(u − w·v) + a_c,   a_c = −sw²·r²/(r²+rc²) · r/(r²+rc²)
      const inX = resolveInput(node.id,'x','0',context);
      const inY = resolveInput(node.id,'y','0',context);
      const inZ = resolveInput(node.id,'z','0',context);
      const inVX = resolveInput(node.id,'vx','0',context);
      const inVY = resolveInput(node.id,'vy','0',context);
      const inVZ = resolveInput(node.id,'vz','0',context);
      const d = node.data;
      const tag = ctxTag+varTag(node.id);
      const cx=PV(node,'cx',d.cx||0,context), cy=PV(node,'cy',d.cy||0,context), cz=PV(node,'cz',d.cz||0,context);
      let ax=d.axisX!==undefined?d.axisX:0, ay=d.axisY!==undefined?d.axisY:1, az=d.axisZ!==undefined?d.axisZ:0;
      const alen = Math.sqrt(ax*ax+ay*ay+az*az)||1;
      ax/=alen; ay/=alen; az/=alen;
      const radiusFallback = (d.radius===undefined||d.radius===null||isNaN(d.radius)) ? 3 : d.radius;
      const strengthFallback = (d.strength===undefined||d.strength===null||isNaN(d.strength)) ? 1 : d.strength;
      const radiusExpr = resolveInput(node.id,'radius', String(radiusFallback), context);
      let strengthExpr = resolveInput(node.id,'strength', String(strengthFallback), context);
      if(d.pulseEnabled){
        const pFreq = PV(node,'pulseFreq',d.pulseFreq!==undefined?d.pulseFreq:1,context);
        const pAmt = PV(node,'pulseAmount',d.pulseAmount!==undefined?d.pulseAmount:0.5,context);
        const pAge = d.pulseTimeSource==='particle_age' ? 'v.particle_age' : 'v.emitter_age';
        strengthExpr = `(${strengthExpr})*(1.0+math.sin(${pAge}*${pFreq}*360.0)*${pAmt})`;
      }
      const falloff = d.falloff!==undefined?d.falloff:1;
      const pull = PV(node,'inwardPull',d.inwardPull||0,context);
      const kdrag = PV(node,'drag',d.drag!==undefined?d.drag:1,context);
      const rc = Math.max(0.01, d.core!==undefined?d.core:0.3);
      const rc2 = findWireInto(node.id,'core') ? (()=>{ const e=`math.max(0.01,${PV(node,'core',0.3,context)})`; return `(${e}*${e})`; })() : rc*rc;
      const radiusV = `v.vx${tag}rad`;
      lines.push(`${radiusV}=math.max(0.01,${radiusExpr});`);
      const dxv=`v.vx${tag}dx`, dyv=`v.vx${tag}dy`, dzv=`v.vx${tag}dz`;
      lines.push(`${dxv}=${subC(inX,cx)};${dyv}=${subC(inY,cy)};${dzv}=${subC(inZ,cz)};`);
      const dotv=`v.vx${tag}dot`;
      lines.push(`${dotv}=${lin([[ax,dxv],[ay,dyv],[az,dzv]])};`);
      const rxv=`v.vx${tag}rx`, ryv=`v.vx${tag}ry`, rzv=`v.vx${tag}rz`;
      lines.push(`${rxv}=${lin([[1,dxv],[-ax,dotv]])};${ryv}=${lin([[1,dyv],[-ay,dotv]])};${rzv}=${lin([[1,dzv],[-az,dotv]])};`);
      const r2v=`v.vx${tag}r2`, rlenv=`v.vx${tag}rlen`, denv=`v.vx${tag}den`;
      lines.push(`${r2v}=${[[ax,rxv],[ay,ryv],[az,rzv]].filter(([a])=>Math.abs(a)!==1).map(([,r])=>r+'*'+r).join('+')||'0.0'};${rlenv}=math.sqrt(${r2v});${denv}=math.sqrt(${r2v}+${rc2});`);
      // 윈도우 w (falloff<=0이면 반경 안 1 / 밖 0)
      const wv=`v.vx${tag}w`;
      if(falloff<=0) lines.push(`${wv}=(${rlenv}<=${radiusV})?1.0:0.0;`);
      else lines.push(`${wv}=math.pow(math.clamp(1.0-(${rlenv}/${radiusV}),0.0,1.0),${falloff});`);
      const sv=`v.vx${tag}s`;
      lines.push(`${sv}=(${strengthExpr})*${wv};`);
      // 접선(axis × r) 성분
      const txv=`v.vx${tag}tx`, tyv=`v.vx${tag}ty`, tzv=`v.vx${tag}tz`;
      lines.push(`${txv}=${lin([[ay,rzv],[-az,ryv]])};${tyv}=${lin([[az,rxv],[-ax,rzv]])};${tzv}=${lin([[ax,ryv],[-ay,rxv]])};`);
      // 구심 가속 계수 ac = −sw²·r²/(r²+rc²)/(r²+rc²) (2계에서만 사용)
      const acv=`v.vx${tag}ac`;
      if(fieldIntegrationOrder(node.id)!==1) lines.push(`${acv}=-(${sv}*${sv})*${r2v}/((${r2v}+${rc2})*(${r2v}+${rc2}));`);
      if(fieldIntegrationOrder(node.id)===1){
        // [v9] 1계(힘→위치 직결): 스텝 h 동안의 선형 소용돌이-싱크 흐름 정확해 r⁺ = e^(−κh)[cos(Ωh)·r + sin(Ωh)·(axis×r)]
        //   를 (r⁺−r)/h 로 내보낸다. Ω = sw/den, κ = pull·Ω. h→0이면 흐름 속도 u와 같다. (Molang 삼각함수는 도(degree) 단위)
        const hE = (subOpts&&subOpts.dtVar) ? subOpts.dtVar : DT60();
        const omv=`v.vx${tag}om`, thv=`v.vx${tag}th`, ev=`v.vx${tag}e`, Av=`v.vx${tag}A`, Bv=`v.vx${tag}B`;
        // [v10] r⁺ = r0 + (r−r0)·e^(−κh) (r0=0이면 r·e^(−κh)), 회전각 = Ω⁺h + (Ω−Ω⁺)(1−e^(−κh))/κ (JS vortexFieldForce와 동일)
        const r0 = Math.max(0, d.orbitRadius||0), kav=`v.vx${tag}ka`, rnv=`v.vx${tag}rn`, onv=`v.vx${tag}on`;
        lines.push(`${omv}=${sv}/${denv};${kav}=${pull}*${omv};${ev}=math.exp(-${kav}*(${hE}));`);
        lines.push(`${rnv}=${r0>0?`${r0}+(${rlenv}-${r0})*${ev}`:`${rlenv}*${ev}`};`);
        const wn = falloff<=0 ? `((${rnv}<=${radiusV})?1.0:0.0)` : `math.pow(math.clamp(1.0-(${rnv}/${radiusV}),0.0,1.0),${falloff})`;
        lines.push(`${onv}=(${strengthExpr})*${wn}/math.sqrt(${rnv}*${rnv}+${rc2});`);
        lines.push(`${thv}=${onv}*(${hE})+(${omv}-${onv})*((math.abs(${kav})>0.000001)?(1.0-${ev})/${kav}:(${hE}));`);
        const qv=`v.vx${tag}q`;
        lines.push(`${qv}=${rnv}/math.max(${rlenv},0.0001);`);
        if(subOpts && subOpts.dtRaw){
          // 고정 격자: κ를 강성(lam)으로 내보내고, Accumulate가 곱할 φ(hκ)만큼 미리 나눠 둔다 → 소용돌이 자체 이동은 그대로 정확.
          lines.push(`${Av}=(${qv}*math.cos(${thv}*${RAD2DEG()})-1.0)/(${hE});${Bv}=${qv}*math.sin(${thv}*${RAD2DEG()})/(${hE});`);
          const R=[rxv,ryv,rzv], Tt=[txv,tyv,tzv];
          [0,1,2].forEach(i=>{
            const fac = vortexAxisFactor(node, i), out = varNameFor(node.id,'f'+'xyz'[i],context);
            if(fac>0){
              const lmv=varNameFor(node.id,'lam'+'xyz'[i],context), zv=`v.vx${tag}z${i}`;
              lines.push(`${lmv}=math.abs(${kav})${fac!==1?'*'+fac:''};${zv}=math.max((${hE})*${lmv},0.0001);`);
              lines.push(`${out}=(${Av}*${R[i]}+${Bv}*${Tt[i]})*${zv}/(1.0-math.exp(-${zv}));`);
            } else lines.push(`${out}=${Av}*${R[i]}+${Bv}*${Tt[i]};`);
          });
        } else {
        lines.push(`${Av}=(${qv}*math.cos(${thv}*${RAD2DEG()})-1.0)/(${hE});${Bv}=${qv}*math.sin(${thv}*${RAD2DEG()})/(${hE});`);
        lines.push(`${varNameFor(node.id,'fx',context)}=${Av}*${rxv}+${Bv}*${txv};`);
        lines.push(`${varNameFor(node.id,'fy',context)}=${Av}*${ryv}+${Bv}*${tyv};`);
        lines.push(`${varNameFor(node.id,'fz',context)}=${Av}*${rzv}+${Bv}*${tzv};`);
        }
      } else {
      const r0o = Math.max(0, d.orbitRadius||0);
      const pE = r0o>0 ? `v.vx${tag}pq` : `(${pull})`;
      if(r0o>0) lines.push(`${pE}=(${pull})*(1.0-${r0o}/math.max(${rlenv},0.0001));`); // [v10] r0로 향하는 반경 흐름
      const fx=`(${kdrag})*((${sv}*(${txv}-${pE}*${rxv})/${denv})-${wv}*(${inVX}))+${acv}*${rxv}`;
      const fy=`(${kdrag})*((${sv}*(${tyv}-${pE}*${ryv})/${denv})-${wv}*(${inVY}))+${acv}*${ryv}`;
      const fz=`(${kdrag})*((${sv}*(${tzv}-${pE}*${rzv})/${denv})-${wv}*(${inVZ}))+${acv}*${rzv}`;
      lines.push(`${varNameFor(node.id,'fx',context)}=${fx};`);
      lines.push(`${varNameFor(node.id,'fy',context)}=${fy};`);
      lines.push(`${varNameFor(node.id,'fz',context)}=${fz};`);
      lines.push(`${varNameFor(node.id,'cd',context)}=(${kdrag})*${wv};`); // [v9] 속도 감쇠율(Accumulate가 음해적으로 처리)
      }
    }

    if(node.type==='attractorfield'){
      // 소프트닝된 보존력 + 점성 감쇠 (JS attractorFieldForce와 동일 공식):
      //   w = (1 − r²/R²)²,  linear: g = 1/√(r²+ε²),  inverse: g = ε²/(r²+ε²)^1.5
      //   F = s·w·g·(center − x) − c·w·v
      const inX = resolveInput(node.id,'x','0',context);
      const inY = resolveInput(node.id,'y','0',context);
      const inZ = resolveInput(node.id,'z','0',context);
      const inVX = resolveInput(node.id,'vx','0',context);
      const inVY = resolveInput(node.id,'vy','0',context);
      const inVZ = resolveInput(node.id,'vz','0',context);
      const d = node.data;
      const tag = ctxTag+varTag(node.id);
      const cx=PV(node,'cx',d.cx||0,context), cy=PV(node,'cy',d.cy||0,context), cz=PV(node,'cz',d.cz||0,context);
      const radiusFallback = (d.radius===undefined||d.radius===null||isNaN(d.radius)) ? 3 : d.radius;
      const strengthFallback = (d.strength===undefined||d.strength===null||isNaN(d.strength)) ? 1 : d.strength;
      const radiusExpr = resolveInput(node.id,'radius', String(radiusFallback), context);
      let strengthExpr = resolveInput(node.id,'strength', String(strengthFallback), context);
      if(d.pulseEnabled){
        const pFreq = PV(node,'pulseFreq',d.pulseFreq!==undefined?d.pulseFreq:1,context);
        const pAmt = PV(node,'pulseAmount',d.pulseAmount!==undefined?d.pulseAmount:0.5,context);
        const pAge = d.pulseTimeSource==='particle_age' ? 'v.particle_age' : 'v.emitter_age';
        strengthExpr = `(${strengthExpr})*(1.0+math.sin(${pAge}*${pFreq}*360.0)*${pAmt})`;
      }
      const eps = Math.max(0.01, d.minDistance!==undefined?d.minDistance:0.2);
      const e2 = findWireInto(node.id,'minDistance') ? (()=>{ const e=`math.max(0.01,${PV(node,'minDistance',0.2,context)})`; return `(${e}*${e})`; })() : eps*eps;
      const cdrag = d.drag||0;
      const radiusV = `v.at${tag}rad`;
      lines.push(`${radiusV}=${radiusExpr};`); // [v9] radius<=0 → 무제한 사거리
      const dxv=`v.at${tag}dx`, dyv=`v.at${tag}dy`, dzv=`v.at${tag}dz`;
      lines.push(`${dxv}=${cx?`(${cx})-`:'-'}(${inX});${dyv}=${cy?`(${cy})-`:'-'}(${inY});${dzv}=${cz?`(${cz})-`:'-'}(${inZ});`);
      const r2v=`v.at${tag}r2`, wv=`v.at${tag}w`, gv=`v.at${tag}g`, sgv=`v.at${tag}sg`;
      lines.push(`${r2v}=${dxv}*${dxv}+${dyv}*${dyv}+${dzv}*${dzv};`);
      lines.push(`${wv}=(${radiusV}>0.0)?(1.0-math.clamp(${r2v}/(math.max(${radiusV},0.01)*math.max(${radiusV},0.01)),0.0,1.0)):1.0;${wv}=${wv}*${wv};`);
      if(d.falloffMode==='inverse') lines.push(`${gv}=${e2}/((${r2v}+${e2})*math.sqrt(${r2v}+${e2}));`);
      else lines.push(`${gv}=1.0/math.sqrt(${r2v}+${e2});`);
      lines.push(`${sgv}=(${strengthExpr})*${wv}*${gv};`);
      if(fieldIntegrationOrder(node.id)===1){
        const hA = (subOpts&&subOpts.dtVar) ? subOpts.dtVar : DT60();
        // 척력: 한 스텝 이동량이 반경 경계(R−r)를 넘지 않게 제한(정확한 해는 R을 넘지 않음)
        const rA=`v.at${tag}r`, mA=`v.at${tag}m`;
        lines.push(`${rA}=math.sqrt(${r2v});${mA}=(${hA})*math.max(-${sgv},0.0)*${rA};`);
        lines.push(`${sgv}=(${sgv}<0.0&&${radiusV}>0.0&&${mA}>0.000000001)?${sgv}*math.min(1.0,math.max(0.0,${radiusV}-${rA})/${mA}):${sgv};`);
      }
      const dragT = (vin)=> (cdrag && vin!=='0') ? `-${cdrag}*${wv}*(${vin})` : '';
      lines.push(`${varNameFor(node.id,'fx',context)}=${dxv}*${sgv}${dragT(inVX)};`);
      lines.push(`${varNameFor(node.id,'fy',context)}=${dyv}*${sgv}${dragT(inVY)};`);
      lines.push(`${varNameFor(node.id,'fz',context)}=${dzv}*${sgv}${dragT(inVZ)};`);
      lines.push(`${varNameFor(node.id,'lam',context)}=math.max(${sgv},0.0);`); // [v9] 복원 강성 Λ (Accumulate 스텝 보정용)
      if(cdrag>0) lines.push(`${varNameFor(node.id,'cd',context)}=${cdrag}*${wv};`);
    }

    if(node.type==='directionalfield'){
      // 위치와 무관하게 항상 같은 방향(정규화됨)으로 strength 배만큼 미는 힘.
      const d = node.data;
      let dx=d.dirX!==undefined?d.dirX:0, dy=d.dirY!==undefined?d.dirY:-1, dz=d.dirZ!==undefined?d.dirZ:0;
      if(['dirX','dirY','dirZ'].some(k=>findWireInto(node.id,k))){ // 방향이 연결되면 실행 중에 정규화
        const T=`v.df${ctxTag}${varTag(node.id)}`, X=PV(node,'dirX',dx,context), Y=PV(node,'dirY',dy,context), Z=PV(node,'dirZ',dz,context);
        lines.push(`${T}x=${X};${T}y=${Y};${T}z=${Z};${T}l=math.max(math.sqrt(${T}x*${T}x+${T}y*${T}y+${T}z*${T}z),0.000001);`);
        dx=`${T}x/${T}l`; dy=`${T}y/${T}l`; dz=`${T}z/${T}l`;
      } else {
      const dlen = Math.sqrt(dx*dx+dy*dy+dz*dz)||1;
      dx/=dlen; dy/=dlen; dz/=dlen;
      }
      const strengthFallback = (d.strength===undefined||d.strength===null||isNaN(d.strength)) ? 1 : d.strength;
      let strengthExpr = resolveInput(node.id,'strength', String(strengthFallback), context);
      if(d.gustEnabled){
        const gFreq = PV(node,'gustFreq',d.gustFreq!==undefined?d.gustFreq:1,context);
        const gAmt = PV(node,'gustAmount',d.gustAmount!==undefined?d.gustAmount:0.5,context);
        const gAge = d.gustTimeSource==='particle_age' ? 'v.particle_age' : 'v.emitter_age';
        strengthExpr = `(${strengthExpr})*(1.0+math.sin(${gAge}*${gFreq}*360.0)*${gAmt})`;
      }
      lines.push(`${varNameFor(node.id,'fx',context)}=(${dx})*(${strengthExpr});`);
      lines.push(`${varNameFor(node.id,'fy',context)}=(${dy})*(${strengthExpr});`);
      lines.push(`${varNameFor(node.id,'fz',context)}=(${dz})*(${strengthExpr});`);
    }

    if(node.type==='windzone'){
      // Directional Force + 영역 제한(box/sphere) + 경계 falloff. 영역 밖이면 힘을 0으로 clamp.
      // turbulence>0이면 방향 벡터에 curlnoise 블록(6-샘플 유한차분) 결과를 섞는다.
      const inX = resolveInput(node.id,'x','0',context);
      const inY = resolveInput(node.id,'y','0',context);
      const inZ = resolveInput(node.id,'z','0',context);
      const d = node.data;
      const tag = ctxTag+varTag(node.id);
      const cx=PV(node,'cx',d.cx||0,context), cy=PV(node,'cy',d.cy||0,context), cz=PV(node,'cz',d.cz||0,context);
      let ddx=d.dirX!==undefined?d.dirX:1, ddy=d.dirY!==undefined?d.dirY:0, ddz=d.dirZ!==undefined?d.dirZ:0;
      if(['dirX','dirY','dirZ'].some(k=>findWireInto(node.id,k))){
        const T=`v.wz${tag}n`, X=PV(node,'dirX',ddx,context), Y=PV(node,'dirY',ddy,context), Z=PV(node,'dirZ',ddz,context);
        lines.push(`${T}x=${X};${T}y=${Y};${T}z=${Z};${T}l=math.max(math.sqrt(${T}x*${T}x+${T}y*${T}y+${T}z*${T}z),0.000001);`);
        ddx=`${T}x/${T}l`; ddy=`${T}y/${T}l`; ddz=`${T}z/${T}l`;
      } else {
      const dlen = Math.sqrt(ddx*ddx+ddy*ddy+ddz*ddz)||1;
      ddx/=dlen; ddy/=dlen; ddz/=dlen;
      }
      const strengthFallback = (d.strength===undefined||d.strength===null||isNaN(d.strength)) ? 1 : d.strength;
      let strengthExpr = resolveInput(node.id,'strength', String(strengthFallback), context);
      if(d.gustEnabled){
        const gFreq = PV(node,'gustFreq',d.gustFreq!==undefined?d.gustFreq:1,context);
        const gAmt = PV(node,'gustAmount',d.gustAmount!==undefined?d.gustAmount:0.5,context);
        const gAge = d.gustTimeSource==='particle_age' ? 'v.particle_age' : 'v.emitter_age';
        strengthExpr = `(${strengthExpr})*(1.0+math.sin(${gAge}*${gFreq}*360.0)*${gAmt})`;
      }
      const falloff = d.falloff!==undefined?d.falloff:1;
      const dxv=`v.wz${tag}dx`, dyv=`v.wz${tag}dy`, dzv=`v.wz${tag}dz`;
      lines.push(`${dxv}=(${inX})-(${cx});${dyv}=(${inY})-(${cy});${dzv}=(${inZ})-(${cz});`);
      const attv=`v.wz${tag}att`, inRangeVar=`v.wz${tag}inr`;
      if(d.shape==='sphere'){
        const radius = findWireInto(node.id,'radius') ? `math.max(0.01,${PV(node,'radius',3,context)})` : Math.max(0.01, d.radius!==undefined?d.radius:3);
        const distv=`v.wz${tag}dist`;
        lines.push(`${distv}=math.sqrt(${dxv}*${dxv}+${dyv}*${dyv}+${dzv}*${dzv});`);
        lines.push(`${inRangeVar}=(${distv}<=${radius})?1.0:0.0;`);
        lines.push(`${attv}=math.clamp(1.0-(${distv}/${radius}),0.0,1.0);`);
      } else {
        const HV=(k)=> findWireInto(node.id,k) ? `math.max(0.01,${PV(node,k,3,context)})` : Math.max(0.01,d[k]!==undefined?d[k]:3);
        const hx=HV('halfX'), hy=HV('halfY'), hz=HV('halfZ');
        lines.push(`${inRangeVar}=(math.abs(${dxv})<=${hx}&&math.abs(${dyv})<=${hy}&&math.abs(${dzv})<=${hz})?1.0:0.0;`);
        const txv=`v.wz${tag}tx`, tyv=`v.wz${tag}ty`, tzv=`v.wz${tag}tz`;
        lines.push(`${txv}=1.0-(math.abs(${dxv})/${hx});${tyv}=1.0-(math.abs(${dyv})/${hy});${tzv}=1.0-(math.abs(${dzv})/${hz});`);
        lines.push(`${attv}=math.min(${txv},math.min(${tyv},${tzv}));`);
      }
      const attFinal=`v.wz${tag}attf`;
      if(falloff<=0){
        lines.push(`${attFinal}=1.0;`);
      } else {
        lines.push(`${attFinal}=math.pow(math.clamp(${attv},0.0,1.0),${falloff});`);
      }
      let fdx=`(${ddx})`, fdy=`(${ddy})`, fdz=`(${ddz})`;
      const turbulence = d.turbulence||0;
      if(turbulence>0){
        // curlnoise와 동일한 6-샘플 유한차분 블록을 여기서도 인라인으로 전개(별도 노드 없이
        // Wind Zone 자체에 내장된 방향 흔들림). noiseScale로 크기를, turbulence로 원래
        // 방향과의 혼합 비율을 조절한다.
        const noiseScale = PV(node,'noiseScale',d.noiseScale!==undefined?d.noiseScale:0.5,context);
        const seed = d.seed||0;
        const npx=`v.wz${tag}npx`, npy=`v.wz${tag}npy`, npz=`v.wz${tag}npz`;
        lines.push(`${npx}=(${inX})*(${noiseScale});${npy}=(${inY})*(${noiseScale});${npz}=(${inZ})*(${noiseScale});`);
        const eps=0.08, twoEps=2.0*eps;
        // [BUGFIX] curlnoise export 블록과 동일한 이유로 6개가 아닌 12개 샘플(성분×이동축)이 필요하다.
        const samples = [
          ['zy_p', npx, `${npy}+${eps}`, npz, 20], ['zy_n', npx, `${npy}-${eps}`, npz, 20],
          ['yz_p', npx, npy, `${npz}+${eps}`, 10], ['yz_n', npx, npy, `${npz}-${eps}`, 10],
          ['xz_p', npx, npy, `${npz}+${eps}`, 0],  ['xz_n', npx, npy, `${npz}-${eps}`, 0],
          ['zx_p', `${npx}+${eps}`, npy, npz, 20], ['zx_n', `${npx}-${eps}`, npy, npz, 20],
          ['yx_p', `${npx}+${eps}`, npy, npz, 10], ['yx_n', `${npx}-${eps}`, npy, npz, 10],
          ['xy_p', npx, `${npy}+${eps}`, npz, 0],  ['xy_n', npx, `${npy}-${eps}`, npz, 0],
        ];
        samples.forEach(([suf,sx,sy,sz,seedOff])=>{
          lines.push(perlinNoiseMolang(sx,sy,sz,`(${seed}+${seedOff})`,`wz${tag}${suf}`));
        });
        const g=(suf)=>`v.wz${tag}${suf}noise`;
        lines.push(`v.wz${tag}cfx=((${g('zy_p')}-${g('zy_n')})/${twoEps})-((${g('yz_p')}-${g('yz_n')})/${twoEps});`);
        lines.push(`v.wz${tag}cfy=((${g('xz_p')}-${g('xz_n')})/${twoEps})-((${g('zx_p')}-${g('zx_n')})/${twoEps});`);
        lines.push(`v.wz${tag}cfz=((${g('yx_p')}-${g('yx_n')})/${twoEps})-((${g('xy_p')}-${g('xy_n')})/${twoEps});`);
        fdx=`((${ddx})*(1.0-${turbulence})+v.wz${tag}cfx*${turbulence})`;
        fdy=`((${ddy})*(1.0-${turbulence})+v.wz${tag}cfy*${turbulence})`;
        fdz=`((${ddz})*(1.0-${turbulence})+v.wz${tag}cfz*${turbulence})`;
      }
      const sv=`v.wz${tag}s`;
      lines.push(`${sv}=(${strengthExpr})*${attFinal};`);
      lines.push(`${varNameFor(node.id,'fx',context)}=(${inRangeVar}>0.5)?(${fdx}*${sv}):0.0;`);
      lines.push(`${varNameFor(node.id,'fy',context)}=(${inRangeVar}>0.5)?(${fdy}*${sv}):0.0;`);
      lines.push(`${varNameFor(node.id,'fz',context)}=(${inRangeVar}>0.5)?(${fdz}*${sv}):0.0;`);
    }

    if(node.type==='wall'){
      // 위치 입력 → 벽 박스 침투 보정 → 위치 출력. 벽은 wall_1, wall_2 ... 순서로 연쇄 적용.
      // 침투 시 가장 가까운 면 바깥으로 e*깊이 만큼 되튕기고(e=반동), 면과 평행한 좌표는
      // (1 - μ*clamp(깊이/반두께,0,1)) 배로 감쇠(μ=마찰력, 이미터 원점 기준).
      wallEnsure(node);
      const tag = ctxTag+varTag(node.id);
      let cx = resolveInput(node.id,'x','0',context);
      let cy = resolveInput(node.id,'y','0',context);
      let cz = resolveInput(node.id,'z','0',context);
      const num = (v,d)=>{ v=Number(v); return isFinite(v)?v:d; };
      const f = v=>pnum(v);
      node.data.walls.forEach((w,wi)=>{
        const P = `v.wl${tag}_${String(w.name).replace(/[^a-zA-Z0-9]/g,'')}_`;
        // [v1.1] 자세히 설정: 벽마다 min/max xyz·마찰력·반동·반동 한계 거리를 입력으로 받을 수 있다(소켓 키 "w번호:칸").
        // 연결된 값은 Molang 식(문자열), 아니면 지금처럼 숫자. 숫자일 때는 예전과 글자 하나 다르지 않은 식이 나온다.
        // 충돌 면을 고르는 일(원점 쪽 면 방식의 축·방향)은 컴파일할 때 정해야 해서 칸에 적힌 숫자로 정한다.
        const WK = k=>{ const key=`w${wi}:${k}`; return findWireInto(node.id,key) ? `(${resolveInput(node.id,key,'0',context)})` : null; };
        const F = v=> typeof v==='number' ? f(v) : v;                       // 숫자→짧은 문자열, 식→그대로
        const addC = (v,c)=> typeof v==='number' ? v+c : `(${v}${c<0?'-':'+'}${f(Math.abs(c))})`;
        const ax=num(w.minX,0), bx=num(w.maxX,0), ay=num(w.minY,0), by=num(w.maxY,0), az=num(w.minZ,0), bz=num(w.maxZ,0);
        const x0=Math.min(ax,bx), x1=Math.max(ax,bx), y0=Math.min(ay,by), y1=Math.max(ay,by), z0=Math.min(az,bz), z1=Math.max(az,bz);
        const frW = WK('friction'), eW = WK('bounce'), rlW = WK('reboundLimit');
        if(frW) lines.push(`${P}fb=math.clamp(${frW},0.0,1.0);`);
        if(eW) lines.push(`${P}eb=math.clamp(${eW},0.0,2.0);`);
        if(rlW) lines.push(`${P}rl=${rlW};`);
        const fr = frW ? `${P}fb` : Math.min(1,Math.max(0,num(w.friction,0)));
        const e = eW ? `${P}eb` : Math.min(2,Math.max(0,num(w.bounce,0)));
        const frOn = typeof fr==='string' || fr>0, eOn = typeof e==='string' || e>0;
        const htx=Math.max(0.001,(x1-x0)/2), hty=Math.max(0.001,(y1-y0)/2), htz=Math.max(0.001,(z1-z0)/2);
        // 경계(식에 들어가는 값): 축마다 min/max 중 하나라도 연결되면 실행 중에 정렬한 변수(b0~b5)를 쓴다.
        const BL=[x0,y0,z0], BH=[x1,y1,z1];
        ['X','Y','Z'].forEach((A,i)=>{ const mn=WK('min'+A), mx=WK('max'+A); if(!mn && !mx) return;
          const sa = mn || f(num(w['min'+A],0)), sb = mx || f(num(w['max'+A],0));
          lines.push(`${P}b${2*i}=math.min(${sa},${sb});${P}b${2*i+1}=math.max(${sa},${sb});`); BL[i]=`${P}b${2*i}`; BH[i]=`${P}b${2*i+1}`; });
        const BC=[BL[0],BH[0],BL[1],BH[1],BL[2],BH[2]];
        const htE = i=> (typeof BL[i]==='number') ? [htx,hty,htz][i] : `math.max(0.001,(${BH[i]}-${BL[i]})/2)`;
        // 반동 한계 거리 Hc: -1(자동)이면 위·아래 벽은 2.72·e·|면|(최소 0.5), 옆 벽은 0(무제한). 0이면 선형, 양수면 그 값.
        const hcRawN = (w.reboundLimit===undefined||w.reboundLimit===null||w.reboundLimit==='') ? -1 : Number(w.reboundLimit);
        const HcOf = (face, isY)=>{
          const auto = !isY ? 0 : ((typeof e==='number' && typeof face==='number') ? Math.max(0.5, 2.72*e*Math.abs(face)) : `math.max(0.5,2.72*${F(e)}*math.abs(${F(face)}))`);
          if(rlW) return `((${P}rl<0)?(${F(auto)}):${P}rl)`;
          return (!isFinite(hcRawN)||hcRawN<0) ? auto : hcRawN;
        };
        const rbTerm = (Hc, dv)=> typeof Hc==='string'
          ? `(((${Hc})>0)?((${F(e)})*${dv}*math.exp(-${dv}/math.max(${Hc},0.000001))):((${F(e)})*${dv}))`
          : (Hc>0 ? `(${F(e)})*${dv}*math.exp(-${dv}/${f(Hc)})` : `(${F(e)})*${dv}`);
        const cmode = node.data.collisionMode||'auto';
        if(cmode==='nearest' || (cmode==='auto' && wallInFeedback(node.id))){
          // [v10.2] 가장 가까운 면 방식(박스 6면). 피드백 그래프에서는 위치가 매 스텝 박스 밖으로 보정되므로, 박스 안에 들어온 입자는
          // 방금 지나온 면 바로 안쪽에 있다 → 가장 얕은 면이 곧 들어온 면이다. 이전의 "원점 쪽 한 면" 방식은 옆면으로 들어온 입자도
          // 바닥면(원점 쪽) 밖으로 밀어내서, 옆면에 붙던 입자가 갑자기 벽 아래로 순간이동했다.
          lines.push(`${P}ix=${cx};${P}iy=${cy};${P}iz=${cz};`);
          const C=[`${P}ix`,`${P}iy`,`${P}iz`], FC=[x0,x1,y0,y1,z0,z1];
          lines.push(`${P}d0=${C[0]}-(${F(BC[0])});${P}d1=(${F(BC[1])})-${C[0]};${P}d2=${C[1]}-(${F(BC[2])});${P}d3=(${F(BC[3])})-${C[1]};${P}d4=${C[2]}-(${F(BC[4])});${P}d5=(${F(BC[5])})-${C[2]};`);
          lines.push(`${P}m=math.min(math.min(${P}d0,${P}d1),math.min(math.min(${P}d2,${P}d3),math.min(${P}d4,${P}d5)));`);
          const kNear = `((${P}d0<=${P}m)?0:((${P}d1<=${P}m)?1:((${P}d2<=${P}m)?2:((${P}d3<=${P}m)?3:((${P}d4<=${P}m)?4:5)))))`;
          // 이력 사용 가능 여부: Accumulate 적분 루프 안이고, 벽 입력이 그 루프의 Accumulate 출력에 바로 연결돼 있을 때.
          // 이때 직전 스텝의 벽 출력(박스 밖)을 기억해 두고, 직전 점→현재 점 선분이 처음 지나간 면(들어온 면)으로 밀어낸다.
          // 큰 스텝 한 번에 박스 깊숙이(중심 근처) 들어가도 "가장 얕은 면"이 아니라 실제로 들어온 면을 고른다.
          const histOK = !!(subOpts && subOpts.preInit) && ['x','y','z'].every(k=>{ const ww=findWireInto(node.id,k); return !ww || (subOpts.selfIds||[]).includes(ww.from.node); });
          // [v10.5] 루프 밖(최종 출력)에서 적용되는 같은 벽은 루프 마지막 스텝 시작 위치(루프 안 벽의 직전 출력)를 직전 점으로 쓴다.
          // 이전엔 여기서 "가장 가까운 면"으로만 판정해서, 마지막 스텝에 많이 움직인 입자가 엉뚱한 면으로 순간이동했다.
          const histRO = !histOK && _wallHist.has(node.id) && context!=='frame';
          let noRb = false;
          if(histOK || histRO){
            const PV = histOK ? [`${P}px`,`${P}py`,`${P}pz`] : _wallHist.get(node.id);
            // 직전 점의 초기값 = 적분 시작 위치(Accumulate 초기값). 이전엔 여기서 아직 계산 전인 ix(지난 프레임 값)를 읽어서
            // 결과가 이전 프레임에 따라 달라졌다(프레임마다 번갈아 튀는 원인).
            if(histOK){ subOpts.preInit.push(`${PV[0]}=${cx};${PV[1]}=${cy};${PV[2]}=${cz};`); _wallHist.set(node.id, PV); PV.grid = !!subOpts.dtRaw; }
            // 고정 격자(grid)에서는 반동을 쓰지 않는다: 한 칸(약 1~2초) 동안 파고든 깊이로 반동을 주면, 칸이 바뀔 때마다 입자가 다 같이
            // 튀어 오르는 주기적인 움직임이 생겼다. 위치만 적분하는 그래프에는 속도가 없어서 반동의 물리적 의미도 없다.
            const noRebound = histOK ? !!subOpts.dtRaw : !!PV.grid; noRb = noRebound;
            // [v10.5] 선분-박스 교차(슬랩 방식). 이전엔 "끝점이 박스 안"일 때만 충돌로 봐서, 한 스텝에 박스를 통째로 지나간 입자
            // (예: 옆면에 붙어 소용돌이로 크게 회전한 경우)는 반대쪽 면 바깥으로 순간이동했다. 이제는 선분이 박스를 지나기만 해도
            // 처음 들어간 면에서 막는다. t=진입 시각(0~1), x=탈출 시각, 2=해당 없음, −1=직전 점이 그 축 범위 안.
            [0,1,2].forEach(i=>{
              const lo=F(BC[2*i]), hi=F(BC[2*i+1]), p0=PV[i], p1=C[i];
              // 면 위의 점(계산 오차로 면에서 1e-5 이내)도 "바깥"으로 본다 — 안쪽으로 잘못 판정되면 가장 가까운 면으로 넘어가 순간이동했다.
              const loE=F(addC(BC[2*i],1e-5)), hiE=F(addC(BC[2*i+1],-1e-5));
              lines.push(`${P}t${i}=(${p0}<=${loE})?((${p1}>${lo})?math.max(((${lo})-${p0})/math.max(${p1}-${p0},0.000001),0.0):2.0):((${p0}>=${hiE})?((${p1}<${hi})?math.max(((${hi})-${p0})/math.min(${p1}-${p0},-0.000001),0.0):2.0):-1.0);`);
              lines.push(`${P}x${i}=(${p1}>${hi}&&${p0}<${hi})?((${hi})-${p0})/math.max(${p1}-${p0},0.000001):((${p1}<${lo}&&${p0}>${lo})?((${lo})-${p0})/math.min(${p1}-${p0},-0.000001):2.0);`);
              lines.push(`${P}s${i}=(${p0}<=${loE})?0:1;`);
            });
            // 진입 면 a(가장 늦게 진입한 축).
            //  - 끝점이 박스 안: 진입 면 위로 투영.
            //  - 박스를 관통(끝점이 다른 면 밖): 진입 면 평면으로 투영(박스 밖 또는 면 위). 옆면으로 빠져나간 경우는 박스 안을 지난
            //    길이에 비례해 막아서, 모서리를 살짝 스치기 시작/끝날 때 위치가 튀지 않게 한다. 반대쪽 같은 축 면으로 빠져나가면 완전히 막는다.
            const band = BL.every(v=>typeof v==='number') ? f(Math.max(0.02, 0.2*Math.min(htx,hty,htz))) : `math.max(0.02,0.2*math.min(${F(htE(0))},math.min(${F(htE(1))},${F(htE(2))})))`;
            lines.push(`${P}tb=math.max(${P}t0,math.max(${P}t1,${P}t2));${P}tx=math.min(${P}x0,math.min(${P}x1,${P}x2));`);
            lines.push(`${P}a=(${P}t0>=${P}tb)?0:((${P}t1>=${P}tb)?1:2);`);
            lines.push(`${P}h=(${P}tb>=0.0&&${P}tb<=1.0&&${P}tb<=${P}tx)?1:0;${P}te=math.min(1.0,${P}tx);`);
            lines.push(`${P}e0=${C[0]}-${PV[0]};${P}e1=${C[1]}-${PV[1]};${P}e2=${C[2]}-${PV[2]};`);
            lines.push(`${P}L=math.sqrt(${P}e0*${P}e0+${P}e1*${P}e1+${P}e2*${P}e2);`);
            // 스칠 때 막는 비율의 폭은 밀어낼 거리(면까지 깊이)에 비례하게 넓힌다 → 위치 변화가 진입점 변화 정도로 제한된다.
            const fcv = i=>`((${P}s${i}==0)?(${F(BC[2*i])}):(${F(BC[2*i+1])}))`;
            lines.push(`${P}da=math.abs((${P}a==0)?(${C[0]}-${fcv(0)}):((${P}a==1)?(${C[1]}-${fcv(1)}):(${C[2]}-${fcv(2)})));`);
            lines.push(`${P}xa=(${P}x0<=${P}tx)?0:((${P}x1<=${P}tx)?1:2);`);
            lines.push(`${P}wa=(${P}tx>1.0||${P}xa==${P}a)?1.0:math.clamp((${P}tx-${P}tb)*${P}L/math.max(${band},${P}da),0.0,1.0);`);
            [0,1,2].forEach(i=>{
              const fc = `((${P}s${i}==0)?(${F(BC[2*i])}):(${F(BC[2*i+1])}))`;
              lines.push(`${P}r${i}=(${P}h>0&&${P}a==${i})?${P}wa*(${C[i]}-${fc}):0.0;`);
            });
            if(!noRebound) lines.push(`${P}q=math.abs((${P}a==0)?${P}r0:((${P}a==1)?${P}r1:${P}r2));`);
            lines.push(`${P}k=(${P}h>0)?-2:((${P}m>0.0)?${kNear}:-1);`);
          } else {
            lines.push(`${P}k=(${P}m<=0.0)?-1:${kNear};`);
          }
          const rb = (face,axis)=> eOn ? rbTerm(HcOf(face, axis===1), `${P}m`) : '';
          const out = [0,1,2].map(i=>{
            const lo=BC[2*i], hi=BC[2*i+1], rl=rb(lo,i), rh=rb(hi,i);
            const base = `(${P}k==${2*i})?(${F(lo)}${rl?'-'+rl:''}):((${P}k==${2*i+1})?(${F(hi)}${rh?'+'+rh:''}):${C[i]})`;
            if(!(histOK || histRO)) return base;
            // 반동: 법선 방향 침투 깊이 q 사용(원점 쪽 면 방식과 같은 감쇠식)
            const rbq = (face)=> eOn ? rbTerm(HcOf(face, i===1), `${P}q`) : '';
            const ql=rbq(lo), qh=rbq(hi);
            const rqv = (!noRb && (ql||qh)) ? `((${P}a==${i})?((${P}s${i}==0)?-(${ql||'0.0'}):(${qh||'0.0'})):0.0)` : '0.0';
            return `(${P}k==-2)?(${C[i]}-${P}r${i}+${rqv}):(${base})`;
          });
          lines.push(`${P}ox=${out[0]};${P}oy=${out[1]};${P}oz=${out[2]};`);
          // 길이 0인 스텝(고정 격자에서 아직 오지 않은 칸)은 위치를 바꾸지 않으므로 직전 점도 바꾸지 않는다.
          // (바꾸면 같은 위치를 다른 직전 점으로 다시 판정해서 막힌 결과가 사라졌다.)
          if(histOK) lines.push(subOpts.dtRaw
            ? `${P}px=(${subOpts.dtRaw}>0.0)?${P}ox:${P}px;${P}py=(${subOpts.dtRaw}>0.0)?${P}oy:${P}py;${P}pz=(${subOpts.dtRaw}>0.0)?${P}oz:${P}pz;`
            : `${P}px=${P}ox;${P}py=${P}oy;${P}pz=${P}oz;`);
          cx=`${P}ox`; cy=`${P}oy`; cz=`${P}oz`;
          return;
        }
        // [떨림 수정] 예전에는 "침투 중 가장 가까운 면"을 매 프레임 다시 골라서, 파티클이 벽 중간을
        // 넘거나 모서리 근처를 지날 때 면이 바뀌며 위치가 튀었고(떨림), 마찰도 면마다 달라졌다.
        // 이제는 이미터 원점(0,0,0)이 있는 쪽 면을 컴파일 시점에 한 번만 고정한다.
        //  - 원점 기준 가장 멀리 떨어진 축을 법선 축으로 선택, 원점 쪽 면이 충돌면.
        //  - 충돌면을 넘어선 깊이 dp는 벽 두께와 무관하게 연속 반사(x' = 면 ∓ e*dp) → 깊이가 변해도 점프 없음.
        //  - 나머지 두 축 범위 안일 때만 충돌(옆으로 벗어난 파티클만 벽을 지나감).
        const lo=[x0,y0,z0], hi=[x1,y1,z1], ht=[htx,hty,htz];
        const outside=[0,1,2].map(i=> (0<lo[i])?(lo[i]-0):((0>hi[i])?(0-hi[i]):-Math.min(0-lo[i],hi[i]-0)));
        let ax_=0; for(let i=1;i<3;i++) if(outside[i]>outside[ax_]) ax_=i;
        const sg = (0>=hi[ax_]) ? 1 : -1; // 1: 원점이 +쪽(면=max), -1: 원점이 -쪽(면=min)
        // [샘플 16 튕김 수정] 입력 식(cx/cy/cz)이 긴 수식 그대로 여러 번 복사돼 식이 폭증했다.
        // (Accumulate 루프 안에서는 이 식이 N번 더 반복되므로 N이 클수록 파서/프리뷰가 멈춘다.)
        // 입력을 변수 하나에 한 번만 계산해 두고 그 변수만 참조한다.
        lines.push(`${P}ix=${cx};${P}iy=${cy};${P}iz=${cz};`);
        const C=[`${P}ix`,`${P}iy`,`${P}iz`], AX=['x','y','z'];
        const face = sg>0 ? BH[ax_] : BL[ax_];   // 식에 들어가는 충돌면 좌표(연결되면 실행 중 값)
        const o1=(ax_+1)%3, o2=(ax_+2)%3;
        const dp = sg>0 ? `(${F(face)}-(${C[ax_]}))` : `((${C[ax_]})-(${F(face)}))`;
        lines.push(`${P}dp=math.max(0.0,${dp});`);
        // [튕긴 뒤 벽을 벗어날 때 급가속 수정] 가장자리 가중치 w가 0이 되면 반사된 위치(벽에서 e·깊이만큼 떨어진 곳)에서
        // 원래 위치로 되돌아가는데, 가중치가 줄어드는 구간(가장자리 15%)이 짧으면 그 큰 이동이 몇 프레임에 몰려
        // 파티클이 순간적으로 2~3배 빠르게 움직였다(측정: 자유 이동 1.7 → 3.9).
        // 가중치가 줄어드는 폭을 "반사로 이동한 양"에 비례해(4배, 최대 벽 너비의 절반) 넓혀 속도 변화를 제한한다.
        // [마찰 점프 수정] 마찰은 면과 평행한 좌표를 (1-μ·진행도) 배로 줄인다. 진행도를 벽 두께(보통 0.1~1칸)로만 나누면
        // 얇은 벽에서 한두 프레임에 몰려 순간이동처럼 보이므로 최소 1.5칸에 걸쳐 서서히 적용한다.
        // [튕긴 뒤 위로 치솟음 수정] 위치만 보고 반사(x'=면+e·깊이)하면 "가속하며 떨어지는" 입력(중력 등)은 반사 후에도 가속 방향이
        // 뒤집혀 위로 가속하며 영원히 올라갔다. 반동 한계 거리 Hc가 있으면 반동량을 e·깊이·exp(-깊이/Hc)로 줄여
        // 한 번 튕겨 오른 뒤 다시 벽면으로 내려앉게 한다(최고 높이 = 0.37·e·Hc).
        //  - 값이 비어 있거나 -1: 자동. 위/아래로 부딪히는 벽(y축)은 중력·부력용으로 Hc=2.72·e·(원점~벽 거리)
        //    (원점에서 떨어뜨린 공의 실제 반동 높이 e²·낙하거리와 같아짐), x/z축 벽은 0(무제한, 일정 속도 반사).
        //  - 0: 항상 선형 반사, 양수: 직접 지정.
        const rebound = rbTerm(HcOf(face, ax_===1), `${P}dp`);
        lines.push(eOn ? `${P}sh=${P}dp+${rebound};` : `${P}sh=${P}dp;`);
        if(frOn) lines.push(`${P}pr=math.clamp(${P}dp/${typeof BL[ax_]==='number' ? f(Math.max(ht[ax_]*2,1.5)) : `math.max(${htE(ax_)}*2,1.5)`},0.0,1.0);`);
        // [벽을 벗어날 때 급가속/뚫림 수정] 충돌 여부(가중치 w)를 "지금" 옆 위치로 판정하면, 튕긴 파티클이 옆으로 벽 범위를
        // 벗어나는 순간 반사 위치 → 원래(벽 뒤쪽) 위치로 되돌아가며 순간이동했다. 대신 이미터 원점에서 날아온 경로가
        // 벽 면을 지난 "충돌 지점"의 옆 좌표로 판정한다. 경로를 따라 계속 날아가도 충돌 지점은 변하지 않아서
        // 한 번 닿은 파티클은 벽 범위를 벗어나도 계속 반사된 쪽에 남는다.
        //  - 일정 속도 이동(x/z축 벽): 충돌 지점 = 옆좌표 × (벽면 거리 / 법선 좌표)
        //  - 가속 이동(y축 벽, 중력 등: 정지에서 출발한 거리 ∝ t²): 시간 비 = √거리비 이므로 제곱근을 취함
        const nrm = C[ax_];
        lines.push(`${P}s=math.min(1.0,math.abs(${F(face)})/math.max(math.abs(${nrm}),0.0001));`);
        lines.push(`${P}hs=${ax_===1 ? `math.sqrt(${P}s)` : `${P}s`};`);
        lines.push(`${P}h1=${P}hs*(${C[o1]});${P}h2=${P}hs*(${C[o2]});`);
        const feOf = o=> typeof BL[o]==='number' ? Math.max(0.05,(hi[o]-lo[o])*0.15) : `math.max(0.05,(${BH[o]}-${BL[o]})*0.15)`;
        const fe1=feOf(o1), fe2=feOf(o2);
        lines.push(`${P}w=math.clamp(math.min(${P}h1-(${F(BL[o1])}),(${F(BH[o1])})-${P}h1)/${F(fe1)},0.0,1.0)*math.clamp(math.min(${P}h2-(${F(BL[o2])}),(${F(BH[o2])})-${P}h2)/${F(fe2)},0.0,1.0);`);
        if(frOn) lines.push(`${P}ff=1.0-(${F(fr)})*${P}w*${P}pr;`);
        const shift = sg>0 ? `${P}sh` : `-${P}sh`;
        const res=[0,1,2].map(i=> i===ax_ ? `(${C[i]})+${P}w*${shift}` : (frOn ? `(${C[i]})*${P}ff` : C[i]));
        lines.push(`${P}ox=${res[0]};`);
        lines.push(`${P}oy=${res[1]};`);
        lines.push(`${P}oz=${res[2]};`);

        cx=`${P}ox`; cy=`${P}oy`; cz=`${P}oz`;
      });
      lines.push(`${varNameFor(node.id,'x',context)}=${cx};${varNameFor(node.id,'y',context)}=${cy};${varNameFor(node.id,'z',context)}=${cz};`);
    }

    if(node.type==='dragfield'){
      // v5: Bedrock 내장 linear_drag_coefficient에 직접 매핑되는 스칼라 계수. 엔진이 실제
      // 현재 속도(velocity)를 자체 추적해 acceleration += -coeff*velocity를 알아서 계산하므로
      // 여기서는 계수값 하나만 출력하면 된다(더 이상 vx/vy/vz를 입력받아 힘을 만들지 않음).
      const coeffFallback = (node.data.dragCoeff===undefined||node.data.dragCoeff===null||isNaN(node.data.dragCoeff)) ? 0.5 : node.data.dragCoeff;
      const coeffExpr = resolveInput(node.id,'coeff', String(coeffFallback), context);
      lines.push(`${varNameFor(node.id,'coeff',context)}=${coeffExpr};`);
    }

    if(node.type==='buoyancyfield'){
      // force = (temperature-ambient) * strength, 방향(dirX,dirY,dirZ 정규화)에 곱해 3축 힘으로 분배.
      // temperature 미연결 + useEmitterAge: (1-age/emitterDuration)^cooldownCurve를 온도로 사용
      // (막 시작했을 때=1(뜨거움) → emitterDuration 이후 0(식음)에서 유지). age는 timeSource
      // 필드에 따라 v.emitter_age(전역 변수, 파티클별 복원 불필요) 또는 v.particle_age(v5부터
      // 유효한 개별 생존시간) 중 하나. ambient는 이 자동 모드에서는 0 취급.
      const d = node.data;
      const tag = ctxTag+varTag(node.id);
      let dx=d.dirX!==undefined?d.dirX:0, dy=d.dirY!==undefined?d.dirY:1, dz=d.dirZ!==undefined?d.dirZ:0;
      const dlen = Math.sqrt(dx*dx+dy*dy+dz*dz)||1;
      dx/=dlen; dy/=dlen; dz/=dlen;
      const strengthFallback = (d.strength===undefined||d.strength===null||isNaN(d.strength)) ? 1 : d.strength;
      const strengthExpr = resolveInput(node.id,'strength', String(strengthFallback), context);
      const tempWire = findWireInto(node.id,'temperature');
      let tempExpr, ambientExpr;
      if(tempWire){
        tempExpr = resolveInput(node.id,'temperature','0',context);
        ambientExpr = String(d.ambient!==undefined?d.ambient:0);
      } else if(d.useEmitterAge){
        const cool = d.cooldownCurve!==undefined?d.cooldownCurve:2;
        const dur = Math.max(0.01, d.emitterDuration!==undefined?d.emitterDuration:2);
        const ageVar = d.timeSource==='particle_age' ? 'v.particle_age' : 'v.emitter_age';
        const baseAge = `math.clamp(1.0-(${ageVar}/(${dur})),0.0,1.0)`;
        tempExpr = Math.abs(cool-1)<1e-6 ? baseAge : `math.pow(${baseAge},${cool})`;
        ambientExpr = '0';
      } else {
        tempExpr = String(d.ambient!==undefined?d.ambient:0); // temperature==ambient → 힘 0
        ambientExpr = String(d.ambient!==undefined?d.ambient:0);
      }
      const diffVar = `v.bf${tag}d`;
      lines.push(`${diffVar}=(${tempExpr})-(${ambientExpr});`);
      const sv = `v.bf${tag}s`;
      lines.push(`${sv}=${diffVar}*(${strengthExpr});`);
      lines.push(`${varNameFor(node.id,'fx',context)}=(${dx})*${sv};`);
      lines.push(`${varNameFor(node.id,'fy',context)}=(${dy})*${sv};`);
      lines.push(`${varNameFor(node.id,'fz',context)}=(${dz})*${sv};`);
    }

    if(node.type==='dissipationfield'){
      // out = max(floor, start * 2^(-t/halfLife)) — half-life 기준 지수 감쇠.
      // rate 소켓이 연결되면 2^(-t/halfLife) 대신 exp(-rate*t) (자연로그 기준)를 직접 쓴다.
      // in 미연결시 자동 시간축은 timeSource 필드로 v.emitter_age 또는 v.particle_age
      // (v5부터 유효한 개별 생존시간) 중 선택.
      const d = node.data;
      const tag = ctxTag+varTag(node.id);
      const tWire = findWireInto(node.id,'in');
      let inT = '0';
      if(tWire){
        inT = resolveInput(node.id,'in','0',context);
      } else if(d.useEmitterAge){
        const dur = Math.max(0.01, d.emitterDuration!==undefined?d.emitterDuration:2);
        const ageVar = d.timeSource==='particle_age' ? 'v.particle_age' : 'v.emitter_age';
        inT = d.emitterMode==='loop' ? `math.mod(${ageVar}/(${dur}),1.0)` : `math.clamp(${ageVar}/(${dur}),0.0,1.0)`;
      }
      const tVar = `v.ds${tag}t`;
      lines.push(`${tVar}=math.max(0.0,${inT});`);
      const start = d.start!==undefined?d.start:1;
      const floor = d.floor!==undefined?d.floor:0;
      const rateWire = findWireInto(node.id,'rate');
      const decayVar = `v.ds${tag}dec`;
      if(rateWire){
        const rateExpr = resolveInput(node.id,'rate','0.693',context);
        lines.push(`${decayVar}=math.exp(-(${rateExpr})*${tVar});`);
      } else {
        const halfLife = Math.max(1e-4, d.halfLife!==undefined?d.halfLife:0.35);
        lines.push(`${decayVar}=math.pow(2.0,-(${tVar})/(${halfLife}));`);
      }
      lines.push(`${varNameFor(node.id,'out',context)}=math.max(${floor},(${start})*${decayVar});`);
    }

    if(node.type==='constant'){
      const uv = constVarName(node.data);
      if(uv){ lines.push(`${varNameFor(node.id,'out',context)}=v.${uv};`); }
      else {
      const cv = Number.isFinite(+node.data.value) ? +node.data.value : 0;
      lines.push(`${varNameFor(node.id,'out',context)}=${cv};`);
      }
    }

    if(node.type==='accumulate'){
      // [v8-5] 상태 없는(stateless) 누적: v.* 에 값을 저장해 프레임 간 이어가지 않는다.
      //   out = init + ∫0..T in(τ) dτ  (T = particle_age 또는 emitter_age)
      // 매 프레임 id(v.fri)·시간에서 처음부터 계산하므로 파티클 간 변수 공유가 생기지 않는다.
      //  - in/reset 미연결: 닫힌 형태 rate*T (정확)
      //  - 연결: in/reset 상류를 N개 중점 샘플 시각 τk=T(k+.5)/N 마다 통째로 다시 컴파일해 펼친 리만합.
      //    clamp는 스텝마다, reset은 샘플마다 순차 적용되므로 경로 의존 동작도 재현되고,
      //    자기 출력을 읽는 피드백 간선은 직전 샘플 값을 읽는다.
      if(subOpts && subOpts.chain.includes(node.id)){
        // 현재 적분 중인 노드(들)의 출력은 루프가 매 샘플 직전 값으로 미리 대입해 두므로 그냥 읽기만 한다.
        if(!(subOpts.selfIds||[subOpts.selfId]).includes(node.id)) errors.push(`Accumulate 노드(${node.id})가 적분 중인 ${(subOpts.selfIds||[subOpts.selfId]).join(', ')}와 init 등 비반복 경로로 서로 얽혀 있어 계산할 수 없습니다. 한쪽의 init 연결을 끊어 주세요.`);
        return;
      }
      // [v8-5-4] 상호 피드백 그룹(Accumulate끼리 in/reset 상류로 서로를 되먹임): 한 상태 벡터로 합동 적분.
      const accGrp = accFeedbackGroup(node.id).filter(id=>state.nodes[id]);
      if(accGrp.length>1){
        const gkey = accGrp[0];
        if(emittedAccGroups.has(gkey)) return;
        emittedAccGroups.add(gkey);
        const ctxT = context==='frame' ? 'fr' : (typeof context==='string' && context.indexOf('motion')===0 ? context.replace(/^motion/,'mo') : 'of');
        const mem = accGrp.map(id=>{
          const dd = state.nodes[id].data, tg = ctxT+varTag(id);
          const initNumM = Number.isFinite(+dd.init)?+dd.init:0;
          const wI = findWireInto(id,'init');
          const lo = Number.isFinite(+dd.min)?+dd.min:0, hi = Number.isFinite(+dd.max)?+dd.max:1;
          const sv = `v.ac${tg}s`;
          const init = wI ? `(${resolveInput(id,'init',String(initNumM),context)})` : initNumM;
          let wrapLine = '';
          if(dd.limitMode==='wrap' && hi>lo){ const sp=hi-lo, bb=`(${lo}-${init})`; wrapLine=`${sv}=${bb}+(${sv}-${bb})-${sp}*math.floor((${sv}-${bb})/${sp});`; }
          return { id, d:dd, sv, init, initWire:wI, outV:varNameFor(id,'out',context),
            clampLine: (dd.limitMode==='clamp' && hi>lo) ? `${sv}=math.clamp(${sv},${lo}-${init},${hi}-${init});` : '',
            wrapLine, k60: dd.mode==='perframe' ? '*60.0' : '',
            wIn: findWireInto(id,'in'), wRs: findWireInto(id,'reset'),
            rateFb: Number.isFinite(+dd.rate)?+dd.rate:1,
            damp: Math.max(0,+dd.damping||0),
            Tsrc: dd.timeSource==='emitter_age' ? 'v.emitter_age' : 'v.particle_age',
            samples: Math.max(1, Math.min(32, Math.round(+dd.samples||8))),
            fields: accStiffFields(id, accGrp), isVel: accIsVelocityLike(id) };
        });
        if(context==='off'){ mem.forEach(m=>lines.push(`${m.outV}=${m.init};`)); return; } // 스폰 시점 T=0
        // init이 같은 그룹의 출력에 의존하면 "시작값이 자기 결과에 의존"하는 진짜 순환이라 풀 수 없다.
        for(const m of mem){
          if(m.initWire && accGrp.some(g=>upstreamReaches(m.initWire.from.node,g))){
            errors.push(`Accumulate 노드(${m.id})의 init이 같은 피드백 그룹(${accGrp.join(', ')})의 출력에 의존합니다. init은 시작값이라 그룹 결과를 쓸 수 없으니 init 연결을 끊거나 다른 노드에서 받아 주세요.`);
            return;
          }
        }
        if(new Set(mem.map(m=>m.Tsrc)).size>1){
          errors.push(`서로 피드백으로 묶인 Accumulate(${accGrp.join(', ')})는 적분 시간 T(timeSource)가 모두 같아야 합니다. particle_age 또는 emitter_age 한쪽으로 통일해 주세요.`);
          return;
        }
        const Tg = mem[0].Tsrc;
        const prodOuterG = (subOpts && subOpts.prod) || 1;
        const Ng = Math.min(accCapN(prodOuterG), Math.max(...mem.map(m=>m.samples)));
        const gtag = ctxT+varTag(gkey);
        const subCtxG = `motionG${shortCtx(gtag)}`;
        const schG = accSchedule(Ng, accTmax(emitter), accModeOf(mem.map(m=>m.d.stepDist), mem.map(m=>m.id)));
        const tvG = `v.ac${gtag}t`, dtvG = `v.ac${gtag}dt`;
        // [물리 수정] 구성원마다 자기 in/reset 상류만 따로 컴파일하고(식 길이 ≈ 기존과 동일), 갱신 순서대로
        // (속도 → 위치) 즉시 반영한다 — 심플렉틱 오일러. 기존엔 모두가 같은 직전 상태를 읽는 전진 오일러라 발산했다.
        const memOrd = accOrderGroup(mem.map(m=>m.id)).map(id=>mem.find(m=>m.id===id));
        // 같은 단계(읽기 거리가 같은 구성원, 예: vx·vy·vz)는 힘 계산 본문을 한 번만 컴파일/실행해 공유한다 —
        // 단계 사이(속도 → 위치)만 순차 갱신하므로 식 길이는 기존(통합 본문 1개)과 거의 같다.
        const stages = [];
        memOrd.forEach(m=>{
          const h = accReadHops(m.id, accGrp), last = stages[stages.length-1];
          if(last && last.h===h) last.ms.push(m); else stages.push({h, ms:[m], body:''});
        });
        const preInitG = [];
        const lamG = [...new Set(mem.filter(m=>!m.isVel).flatMap(m=>m.fields.flatMap(fid=>fieldStiffVars(fid,subCtxG).lam)))];
        const lamM = {}; mem.forEach(m=>{ lamM[m.id] = m.isVel ? [] : [...new Set(m.fields.flatMap(fid=>fieldStiffVars(fid,subCtxG,schG.grid,fieldAxisFor(fid,m.id)).lam))]; });
        const dtFormulaForG = schG.grid ? (nid=>{ const mm=feedsSingleMember(nid, mem.map(m=>m.id)); return (mm && lamM[mm] && lamM[mm].length) ? effDtMolang(`v.ac${gtag}hd`, lamM[mm]) : null; }) : null;
        for(const st of stages){
          const rm = [...new Set(st.ms.flatMap(m=>[m.wIn,m.wRs].filter(Boolean).map(w=>w.from.node)))].filter(id=>state.nodes[id]);
          if(!rm.length) continue;
          const sg = buildGraph(subCtxG, emitter, outputNode, splitOpts, { preInit:preInitG, dtRaw: schG.grid ? dtvG : null, dtFormulaFor: dtFormulaForG, dtFormula: lamG.length ? effDtMolang(`v.ac${gtag}hd`, lamG) : null, roots:rm, selfIds:accGrp, selfId:gkey, chain:[...(subOpts?subOpts.chain:[]), ...accGrp], prod:prodOuterG*Ng, bound: context!=='frame', dtVar:`v.ac${gtag}hd` });
          if(sg.errors){ sg.errors.forEach(e=>errors.push(e)); return; }
          st.body = sg.lines.join('').replace(/v\.(particle_age|emitter_age)\b/g, tvG);
        }
        // [v9] 루프 불변 문장(노이즈 등)은 한 번만 계산해 식 길이를 줄이고 분할 수 N이 1로 깎이는 것을 막는다.
        const seedsG = [tvG, ...mem.map(m=>varNameFor(m.id,'out',subCtxG)), ...(schG.grid?[dtvG,`v.ac${gtag}hd`]:[])], seenInv = new Set(); let hoistStr = '';
        for(const st of stages){
          const hz = hoistInvariant(st.body, seedsG); st.body = hz.vary;
          const parts = hz.inv.split(';').filter(Boolean), cnt = {};
          parts.forEach(s=>{ const l=s.slice(0,s.indexOf('=')); cnt[l]=(cnt[l]||0)+1; });
          parts.forEach(s=>{ const l=s.slice(0,s.indexOf('=')); if(cnt[l]===1 && seenInv.has(s)) return; seenInv.add(s); hoistStr += s+';'; });
        }
        if(schG.grid){ schG.ov = `v.ac${gtag}go`; lines.push(schG.initM()); }
        lines.push(mem.map(m=>`${m.sv}=0;`).join('')+(schG.grid?'':`${dtvG}=${Tg}*${pnum(schG.w(0))};v.ac${gtag}hd=math.max(${dtvG}${mem[0].k60},0.0001);`)+mem.map(m=>`${varNameFor(m.id,'out',subCtxG)}=${m.init};`).join('')+[...new Set(preInitG)].join('')+hoistStr);
        for(let k=0;k<Ng;k++){
          let seg = schG.grid
            ? `${schG.dtS(k,Tg,dtvG)}v.ac${gtag}hd=math.max(${dtvG}${mem[0].k60},0.0001);${tvG}=${schG.midM(k,dtvG)};`
            : `${tvG}=${Tg}*${pnum(schG.mid(k))};` + (k>0 && Math.abs(schG.w(k)-schG.w(k-1))>1e-7 ? `${dtvG}=${Tg}*${pnum(schG.w(k))};v.ac${gtag}hd=math.max(${dtvG}${mem[0].k60},0.0001);` : '');
          for(const st of stages){
            const need = st.ms.some(m=>{
              const r0 = Math.max(1, Math.round(Ng/m.samples)), st0 = Math.floor(k/r0)*r0, en0 = Math.min(st0+r0, Ng), md0 = Math.floor((st0+en0-1)/2);
              return k===md0 || (m.wRs && k===en0-1);
            });
            if(need) seg += st.body;
            // 같은 단계 구성원은 본문이 만든 같은 값을 읽고, 갱신 결과는 다음 단계부터 보인다.
            const upd = [];
            st.ms.forEach(m=>{
              // [v8-5-4] 노드별 samples: 이 노드는 r개 기본 스텝을 한 구간으로 묶어 구간 중간에서 in을 표본 추출하고,
              // 구간 마지막 스텝에서 (구간 길이 L)×dt 만큼 한 번에 갱신한다. r=1이면 매 스텝 갱신(이전과 동일).
              const r0 = Math.max(1, Math.round(Ng/m.samples)), st0 = Math.floor(k/r0)*r0, en0 = Math.min(st0+r0, Ng), md0 = Math.floor((st0+en0-1)/2);
              const inE0 = m.wIn ? resolveInput(m.id,'in',String(m.rateFb),subCtxG) : String(m.rateFb);
              const hold = `v.ac${ctxT+varTag(m.id)}h`;
              // [v9] 힘 노드 강성(Λ)으로 스텝 보정: 1계=지수 오일러 φ(hΛ), 2계=1/(1+hc+h²Λ). 강성 필드가 없으면 기존과 동일.
              const Lm = en0-st0, hEff = `${Lm>1?(schG.grid?`(${schG.spanM(st0,en0,Tg)})`:`(${Tg}*${pnum(schG.b[en0]-schG.b[st0])})`):dtvG}${m.k60}`;
              let inE = inE0;
              if(m.fields.length){ // [v10.2] 1계=지수 오일러 φ(hλ)(Formula dt=h·φ로 벽 보정은 정확히 유지), 2계=음해 — in 전체(벽 보정 포함)에 곱하지 않음
                const lamL=[], cdL=[]; m.fields.forEach(fid=>{ const t=fieldStiffVars(fid,subCtxG,schG.grid,fieldAxisFor(fid,m.id)); lamL.push(...t.lam); cdL.push(...t.cd); });
                const sf = stiffFactorMolang(m.isVel, hEff, lamL, cdL, `v.ac${ctxT+varTag(m.id)}z`);
                if(sf.expr) inE = `(${inE0})*${sf.expr}`;
                if(sf.pre && (k===md0)) seg += sf.pre;
              }
              if(k===md0 && k!==en0-1) seg += `${hold}=${inE};`;
              if(k===en0-1){
                const L = en0-st0;
                const hStr = L>1 ? (schG.grid?`(${schG.spanM(st0,en0,Tg)})`:`(${Tg}*${pnum(schG.b[en0]-schG.b[st0])})`) : dtvG;
                let u = '';
                if(m.wRs) u += `${m.sv}=${m.sv}*math.clamp(1.0-(${resolveInput(m.id,'reset','0',subCtxG)}),0.0,1.0);`;
                u += m.damp>0
                  ? `${m.sv}=(${m.sv}+(${md0===k?inE:hold})*${hStr}${m.k60})/(1.0+${m.damp}*${hStr});${m.clampLine}`
                  : `${m.sv}=${m.sv}+(${md0===k?inE:hold})*${hStr}${m.k60};${m.clampLine}`;
                u += `${varNameFor(m.id,'out',subCtxG)}=${m.init}+${m.sv};`;
                upd.push(u);
              }
            });
            seg += upd.join('');
          }
          lines.push(seg);
        }
        mem.forEach(m=>lines.push(`${m.wrapLine}${m.outV}=${m.init}+${m.sv};`));
        return;
      }
      const d = node.data;
      const tag = ctxTag+varTag(node.id);
      const outV = varNameFor(node.id,'out',context);
      const initNum = Number.isFinite(+d.init)?+d.init:0;
      const init = findWireInto(node.id,'init') ? `(${resolveInput(node.id,'init',String(initNum),context)})` : initNum;
      if(context==='off'){ lines.push(`${outV}=${init};`); return; } // 스폰 시점 T=0
      const sv=`v.ac${tag}s`, tv=`v.ac${tag}t`, dtv=`v.ac${tag}dt`;
      const T = d.timeSource==='emitter_age' ? 'v.emitter_age' : 'v.particle_age';
      const rateFb = Number.isFinite(+d.rate)?+d.rate:1;
      const lo = Number.isFinite(+d.min)?+d.min:0, hi = Number.isFinite(+d.max)?+d.max:1;
      const clampLine = (d.limitMode==='clamp' && hi>lo) ? `${sv}=math.clamp(${sv},${lo}-${init},${hi}-${init});` : '';
      let wrapLine = '';
      if(d.limitMode==='wrap' && hi>lo){ const sp=hi-lo, bb=`(${lo}-${init})`; wrapLine=`${sv}=${bb}+(${sv}-${bb})-${sp}*math.floor((${sv}-${bb})/${sp});`; }
      const k60 = d.mode==='perframe' ? '*60.0' : '';
      const wIn = findWireInto(node.id,'in') || findWireInto(node.id,'rate'), wRs = findWireInto(node.id,'reset'); // [v10.9] rate 연결 = 초당 증가량 입력
      const inKeyA = wIn ? wIn.to.socket : 'in';
      const dampS = Math.max(0,+d.damping||0);
      if(!wIn && !wRs){
        const closed = dampS>0 ? `(${rateFb})${k60}*(1.0-math.exp(-${dampS}*${T}))/${dampS}` : `(${rateFb})*${T}${k60}`;
        lines.push(`${sv}=${closed};${clampLine}${wrapLine}${outV}=${init}+${sv};`);
        return;
      }
      // [샘플 16 튕김 수정] Accumulate가 겹쳐 있으면(가속도→속도→위치) 식 길이가 N^깊이로 폭증한다.
      // 바깥 적분의 총 분할 수 곱이 ACC_BUDGET을 넘지 않도록 안쪽 Accumulate의 N을 자동으로 낮춘다.
      const prodOuter = (subOpts && subOpts.prod) || 1;
      const N = Math.max(1, Math.min(accCapN(prodOuter), Math.round(+d.samples||8)));
      const subCtx = `motionA${shortCtx(tag)}`;
      const sch1 = accSchedule(N, accTmax(emitter), accModeOf([d.stepDist],[node.id]));
      const roots = [wIn,wRs].filter(Boolean).map(w=>w.from.node).filter(id=>state.nodes[id]);
      const preInit1 = [];
      const sFields0 = accStiffFields(node.id,[node.id]), lam1 = accIsVelocityLike(node.id) ? [] : [...new Set(sFields0.flatMap(fid=>fieldStiffVars(fid,subCtx,sch1.grid,fieldAxisFor(fid,node.id)).lam))];
      const sub = buildGraph(subCtx, emitter, outputNode, splitOpts, { preInit:preInit1, dtRaw: sch1.grid ? dtv : null, dtFormula: lam1.length ? effDtMolang(`v.ac${tag}hd`, lam1) : null, roots, selfId:node.id, selfIds:[node.id], chain:[...(subOpts?subOpts.chain:[]), node.id], prod:prodOuter*N, bound: context!=='frame', dtVar:`v.ac${tag}hd` });
      if(sub.errors){ sub.errors.forEach(e=>errors.push(e)); return; }
      const subBody0 = sub.lines.join('').replace(/v\.(particle_age|emitter_age)\b/g, tv);
      const fb = isFeedbackWire(node.id,'in') || isFeedbackWire(node.id,'reset');
      const subOut = varNameFor(node.id,'out',subCtx);
      const sFields = accStiffFields(node.id,[node.id]), sIsVel = accIsVelocityLike(node.id);
      const hz1 = hoistInvariant(subBody0, [tv, subOut, ...(sch1.grid?[dtv,`v.ac${tag}hd`]:[])]), subBody = hz1.vary; // [v9] 루프 불변 문장 호이스팅
      if(sch1.grid){ sch1.ov = `v.ac${tag}go`; lines.push(sch1.initM()); }
      lines.push(`${sv}=0;${sch1.grid?'':`${dtv}=${T}*${pnum(sch1.w(0))};v.ac${tag}hd=math.max(${dtv}${k60},0.0001);`}${preInit1.length?`${subOut}=${init};`+[...new Set(preInit1)].join(''):''}${hz1.inv}`);
      for(let k=0;k<N;k++){
        let seg = sch1.grid
          ? `${sch1.dtS(k,T,dtv)}v.ac${tag}hd=math.max(${dtv}${k60},0.0001);${tv}=${sch1.midM(k,dtv)};`
          : `${tv}=${T}*${pnum(sch1.mid(k))};` + (k>0 && Math.abs(sch1.w(k)-sch1.w(k-1))>1e-7 ? `${dtv}=${T}*${pnum(sch1.w(k))};v.ac${tag}hd=math.max(${dtv}${k60},0.0001);` : '');
        if(fb) seg += `${subOut}=${init}+${sv};`; // 피드백: 직전 샘플까지의 값
        seg += subBody;
        if(wRs) seg += `${sv}=${sv}*math.clamp(1.0-(${resolveInput(node.id,'reset','0',subCtx)}),0.0,1.0);`;
        let r = wIn ? resolveInput(node.id,inKeyA,String(rateFb),subCtx) : String(rateFb);
        if(sFields.length){ // [v9] 힘 노드 강성(Λ)으로 스텝 보정 (1계=지수 오일러, 2계=음해)
          const lamL=[], cdL=[]; sFields.forEach(fid=>{ const t=fieldStiffVars(fid,subCtx,sch1.grid,fieldAxisFor(fid,node.id)); lamL.push(...t.lam); cdL.push(...t.cd); });
          const sf = stiffFactorMolang(sIsVel, `${dtv}${k60}`, lamL, cdL, `v.ac${tag}z`);
          if(sf.expr){ seg += sf.pre; r = `(${r})*${sf.expr}`; }
        }
        seg += dampS>0
          ? `${sv}=(${sv}+(${r})*${dtv}${k60})/(1.0+${dampS}*${dtv});${clampLine}`
          : `${sv}=${sv}+(${r})*${dtv}${k60};${clampLine}`;
        lines.push(seg);
      }
      lines.push(`${wrapLine}${outV}=${init}+${sv};`);
    }

    if(node.type==='remap'){
      const inV = resolveInput(node.id,'in','0',context);
      const d = node.data;
      const inMin=PV(node,'inMin',d.inMin!==undefined?d.inMin:-1,context), inMax=PV(node,'inMax',d.inMax!==undefined?d.inMax:1,context);
      const outMin=PV(node,'outMin',d.outMin!==undefined?d.outMin:0,context), outMax=PV(node,'outMax',d.outMax!==undefined?d.outMax:1,context);
      const tVar = `v.rm${ctxTag}${varTag(node.id)}t`;
      let span;
      if(typeof inMin==='number' && typeof inMax==='number') span = Math.abs(inMax-inMin)<1e-9 ? 1e-9 : (inMax-inMin);
      else { span = `v.rm${ctxTag}${varTag(node.id)}sp`; lines.push(`${span}=(${inMax})-(${inMin});${span}=(math.abs(${span})<0.000000001)?0.000000001:${span};`); }
      lines.push(`${tVar}=(((${inV})-(${inMin}))/(${span}))*(${outMax}-(${outMin}))+(${outMin});`);
      const outExpr = d.clampOut ? `math.clamp(${tVar},math.min(${outMin},${outMax}),math.max(${outMin},${outMax}))` : tVar;
      lines.push(`${varNameFor(node.id,'out',context)}=${outExpr};`);
    }

    if(node.type==='vecfield_image'){
      // Export 방식 두 가지:
      //  - lookup   : res×res 그리드를 좌표→인덱스 변환 후 중첩 삼항(?:) 체인으로 정확히 재현.
      //               삼항 개수 = res*res(채널당). 개수가 사용자가 정한 상한을 넘으면 Bedrock
      //               파싱 안정성을 위해 자동으로 fourier로 강등한다.
      //  - fourier  : 베이킹 시 미리 피팅해둔 저주파 sin/cos 계수 합으로 근사. 조건문이 전혀
      //               없고, 길이가 셀 개수가 아니라 "항 개수"로 고정되므로 해상도를 올려도 export
      //               크기가 늘지 않는다. 정확도는 낮지만 항 개수로 조절 가능.
      if(!node.data.bakedGrid){
        errors.push(`Vector Field (Image) 노드(${node.id})에 아직 이미지가 업로드되지 않았습니다 — 힘이 0으로 출력됩니다.`);
      }
      const res = Math.max(4, Math.round(node.data.resolution||16));
      const grid = node.data.bakedGrid;
      const inX = resolveInput(node.id,'x','0',context);
      const inY = resolveInput(node.id,'y','0',context);
      const tag = ctxTag+varTag(node.id);
      const area = Math.max(0.001, node.data.areaSize||4);
      const amp = node.data.amplitude!==undefined?node.data.amplitude:1;
      const fxVar=`v.vf${tag}fx`, fyVar=`v.vf${tag}fy`;

      const ternaryLimit = Math.max(4, Math.round(node.data.lookupMaxTernaries||20));
      const cellCount = res*res;
      const wantsLookup = node.data.exportMode==='lookup';
      const useLookup = wantsLookup && cellCount<=ternaryLimit && grid && grid.length===res*res;

      if(wantsLookup && !useLookup && grid){
        errors.push(`Vector Field (Image) 노드(${node.id}): 그리드 ${cellCount}칸이 삼항 상한(${ternaryLimit})을 초과해 저주파 근사(fourier)로 자동 전환되었습니다. 정확한 룩업을 쓰려면 베이킹 해상도를 낮추거나 상한을 올리세요.`);
      }

      if(useLookup){
        // 좌표를 0~res-1 정수 그리드 인덱스로 변환한 뒤, 행→열 순으로 중첩된 (cond)?a:b 체인으로
        // "해당 셀이면 그 값, 아니면 다음 후보"를 표현 — 배열이 없는 Molang에서의 룩업 우회법.
        const gxVar=`v.vf${tag}gx`, gyVar=`v.vf${tag}gy`;
        lines.push(`${gxVar}=math.clamp(math.floor((((${inX})/${area})+0.5)*${res}),0,${res-1});`);
        lines.push(`${gyVar}=math.clamp(math.floor((((${inY})/${area})+0.5)*${res}),0,${res-1});`);
        const buildRowExpr = (channel)=>{
          let rowExprs = [];
          for(let ry=0; ry<res; ry++){
            let colExpr = pnum(grid[ry*res+(res-1)][channel]);
            for(let rx=res-2; rx>=0; rx--){
              const v = pnum(grid[ry*res+rx][channel]);
              colExpr = `((${gxVar})==${rx}?${v}:${colExpr})`;
            }
            rowExprs.push(colExpr);
          }
          let full = rowExprs[res-1];
          for(let ry=res-2; ry>=0; ry--){
            full = `((${gyVar})==${ry}?${rowExprs[ry]}:${full})`;
          }
          return full;
        };
        lines.push(`${fxVar}=${buildRowExpr(0)};`);
        lines.push(`${fyVar}=${buildRowExpr(1)};`);
      } else if(node.data.fourierCoeffs){
        // 저주파 근사: 좌표를 -1~1로 정규화한 뒤 sum[a*sin(mπx+nπy) + b*cos(mπx+nπy)]를 그대로 이어붙인다.
        // 조건문이 없으므로 항 개수와 무관하게 항상 안전하게 파싱된다.
        //
        // 최적화 2건 (perframe에서 파티클수×항개수만큼 반복 평가되는 지점이라 효과가 큼):
        //  1) phase를 sin/cos 호출마다 문자열로 두 번 안 박고, 항당 변수 하나에 한 번만 계산해
        //     재사용 — 곱셈/덧셈 연산 수를 절반으로 줄인다.
        //  2) m*π, n*π는 항의 정수 계수와 상수 π의 곱이라 베이크 시점에 JS에서 미리 계산해
        //     상수로 굽는다 — Molang에서 매 프레임 곱하던 "m.0*3.14159265" 연산 자체를 제거.
        const nxVar=`v.vf${tag}nx`, nyVar=`v.vf${tag}ny`;
        lines.push(`${nxVar}=math.clamp((((${inX})/${area})+0.5)*2.0-1.0,-1.0,1.0);${nyVar}=math.clamp((((${inY})/${area})+0.5)*2.0-1.0,-1.0,1.0);`);
        const PI = Math.PI;
        const buildFourierExpr = (terms, axisTag)=>{
          if(!terms || !terms.length) return '0.0';
          const sumParts = terms.map(({m,n,a,b}, i)=>{
            const pVar = `v.vf${tag}${axisTag}p${i}`;
            const mPi = pnum(m*PI);
            const nPi = pnum(n*PI);
            // m/n이 0인 항은 그 절반이 통째로 사라지므로 곱셈 자체를 생략
            const mTerm = m ? `${mPi}*${nxVar}` : null;
            const nTerm = n ? `${nPi}*${nyVar}` : null;
            const phaseExpr = [mTerm, nTerm].filter(Boolean).join('+') || '0.0';
            lines.push(`${pVar}=${phaseExpr};`);
            return `(${pnum(a)}*math.sin(${pVar})+${pnum(b)}*math.cos(${pVar}))`;
          });
          return sumParts.join('+');
        };
        lines.push(`${fxVar}=${buildFourierExpr(node.data.fourierCoeffs.fx,'fx')};`);
        lines.push(`${fyVar}=${buildFourierExpr(node.data.fourierCoeffs.fy,'fy')};`);
      } else {
        lines.push(`${fxVar}=0.0;${fyVar}=0.0;`);
      }
      lines.push(`${varNameFor(node.id,'fx',context)}=${fxVar}*${amp};`);
      lines.push(`${varNameFor(node.id,'fy',context)}=${fyVar}*${amp};`);
    }

    if(node.type==='gradient'){
      // t(0~1)를 받아 정지점들 사이를 선형보간한 r/g/b를 낸다. Molang에는 배열/루프가 없으므로,
      // math.clamp + math.lerp 체인을 정지점 개수만큼 이어붙여 구간별 보간을 표현한다.
      const inT = resolveInput(node.id,'t','0',context);
      const tag = ctxTag+varTag(node.id);
      const stops = [...node.data.stops].sort((a,b)=>a.pos-b.pos);
      const tVar = `v.gr${tag}t`;
      lines.push(`${tVar}=math.clamp(${inT},0.0,1.0);`);
      // 최적화: 구간별 localT = clamp((t-a.pos)/span, 0, 1)는 정지점 "위치"에만 의존하고
      // r/g/b 색상값과는 무관하다. 기존에는 이 식이 r/g/b 세 채널에서 각각 다시 계산돼
      // 구간당 3번(클램프+나눗셈+뺄셈 세트) 반복됐는데, 구간당 변수 하나에 한 번만 계산해
      // 세 채널이 같이 재사용하도록 바꾼다. 비교식(t<b.pos)도 채널과 무관하므로 함께 재사용.
      const localTVars = [];
      for(let i=1;i<stops.length;i++){
        const a=stops[i-1], b=stops[i];
        const span = Math.max(1e-6, b.pos-a.pos);
        const ltVar = `v.gr${tag}lt${i}`;
        lines.push(`${ltVar}=math.clamp((${tVar}-(${a.pos}))/(${span}),0.0,1.0);`);
        localTVars.push(ltVar);
      }
      ['r','g','b'].forEach((ch,ci)=>{
        const chVal = (hex)=>{
          const n = parseInt(hex.slice(1),16);
          return [((n>>16)&255)/255, ((n>>8)&255)/255, (n&255)/255][ci];
        };
        // 구간별 lerp 체인: t가 각 정지점 구간 [a.pos,b.pos) 안에 있으면 그 구간에서 보간하고,
        // 아니면 다음 구간(더 바깥쪽 expr)으로 넘어간다 — 삼항 연산자를 중첩해 배열/루프 없이 표현.
        let expr = String(chVal(stops[0].color));
        for(let i=1;i<stops.length;i++){
          const b=stops[i];
          expr = `((${tVar})<(${b.pos})?math.lerp((${expr}),(${chVal(b.color)}),${localTVars[i-1]}):(${chVal(b.color)}))`;
        }
        lines.push(`${varNameFor(node.id,ch,context)}=${expr};`);
      });
    }

    if(node.type==='curve'){
      // t 입력이 없으면 자동으로 시간축을 만들어 쓴다 — timeSource 필드로 선택한 v.emitter_age
      // (이미터 전역 경과시간) 또는 v.particle_age(개별 파티클 생존시간, v5부터 유효)를
      // emitterDuration(초)로 나눠 0~1 축을 만든다. loop(나머지) 또는 once(clamp) 중 선택.
      const tWire = findWireInto(node.id,'t');
      let inT = '0';
      if(tWire){
        inT = resolveInput(node.id,'t','0',context);
      } else if(node.data.useEmitterAge){
        const dur = node.data.emitterDuration || 1;
        const ageVar = node.data.timeSource==='particle_age' ? 'v.particle_age' : 'v.emitter_age';
        if(node.data.emitterMode==='once'){
          inT = `math.clamp(${ageVar}/(${dur}),0.0,1.0)`;
        } else {
          inT = `math.mod(${ageVar}/(${dur}),1.0)`;
        }
      }
      const tag = ctxTag+varTag(node.id);
      const tVar = `v.cv${tag}t`;
      lines.push(`${tVar}=math.clamp(${inT},0.0,1.0);`);
      const pts = [...node.data.points].sort((a,b)=>a.x-b.x);
      let expr = String(pts[0].y);
      for(let i=1;i<pts.length;i++){
        const a=pts[i-1], b=pts[i];
        const span = Math.max(1e-6, b.x-a.x);
        const localT = `math.clamp((${tVar}-(${a.x}))/(${span}),0.0,1.0)`;
        expr = `((${tVar})<(${b.x})?math.lerp((${expr}),(${b.y}),${localT}):(${b.y}))`;
      }
      lines.push(`${varNameFor(node.id,'out',context)}=${expr};`);
    }

    if(node.type==='flipbook'){
      // 진행 시간축은 timeSource 필드로 v.emitter_age(전역 경과시간) 또는 v.particle_age
      // (개별 생존시간, v5부터 유효) 중 선택. 프레임 재생 길이(dur) = frameCount/fps(초)
      // 동안 전체 구간을 한 번 훑는다.
      const d = node.data;
      const cols = Math.max(1, Math.round(d.columns||4)), rows = Math.max(1, Math.round(d.rows||4));
      const fw = Math.max(1, Math.round(d.frameWidth||16)), fh = Math.max(1, Math.round(d.frameHeight||16));
      const startFrame = Math.max(0, Math.round(d.startFrame||0));
      const frameCount = Math.max(1, Math.round(d.frameCount||cols*rows));
      const tWire = findWireInto(node.id,'t');
      let progExpr;
      if(tWire){
        progExpr = `math.clamp(${resolveInput(node.id,'t','0',context)},0.0,1.0)`;
      } else {
        const dur = frameCount/Math.max(1e-6, d.fps||24);
        const ageVar = d.timeSource==='particle_age' ? 'v.particle_age' : 'v.emitter_age';
        progExpr = d.loopMode==='once' ? `math.clamp(${ageVar}/(${dur}),0.0,1.0)` : `math.mod(${ageVar}/(${dur}),1.0)`;
      }
      const tag = ctxTag+varTag(node.id);
      const progVar = `v.fb${tag}p`, idxVar = `v.fb${tag}i`;
      lines.push(`${progVar}=${progExpr};`);
      if(d.loopMode==='pingpong'){
        const span = Math.max(1, frameCount-1);
        lines.push(`${idxVar}=math.mod(${progVar}*${span}*2.0,${span}*2.0);`);
        lines.push(`${idxVar}=(${idxVar}<=${span})?math.round(${idxVar}):math.round(${span}*2.0-${idxVar});`);
      } else {
        lines.push(`${idxVar}=math.min(${frameCount-1},math.floor(${progVar}*${frameCount}));`);
      }
      const globalFrameExpr = `math.min(${cols*rows-1},${startFrame}+${idxVar})`;
      const gfVar = `v.fb${tag}g`;
      lines.push(`${gfVar}=${globalFrameExpr};`);
      const uExpr = `math.mod(${gfVar},${cols})*${fw}`;
      const vExpr = `math.floor(${gfVar}/${cols})*${fh}`;
      lines.push(`${varNameFor(node.id,'u',context)}=${uExpr};`);
      lines.push(`${varNameFor(node.id,'v',context)}=${vExpr};`);
      lines.push(`${varNameFor(node.id,'uw',context)}=${fw};`);
      lines.push(`${varNameFor(node.id,'uh',context)}=${fh};`);
    }

    if(node.type==='threshold'){
      const inV = resolveInput(node.id,'in','0',context);
      const wEdge = findWireInto(node.id,'edge');
      const d = node.data;
      const thExpr = wEdge ? resolveInput(node.id,'edge','0',context) : String(d.threshold!==undefined?d.threshold:0.5);
      const soft = Math.max(0, d.softness||0);
      const tag = ctxTag+varTag(node.id);
      const inVar = `v.th${tag}v`;
      lines.push(`${inVar}=${inV};`);
      let outExpr;
      if(soft<1e-6){
        outExpr = `(${inVar}>=(${thExpr})?1.0:0.0)`;
      } else {
        const loVar = `v.th${tag}lo`, xVar = `v.th${tag}x`;
        lines.push(`${loVar}=${thExpr};`);
        lines.push(`${xVar}=math.clamp((${inVar}-(${loVar}))/(${soft}),0.0,1.0);`);
        outExpr = `(${xVar}*${xVar}*(3.0-2.0*${xVar}))`;
      }
      lines.push(`${varNameFor(node.id,'out',context)}=${d.invert ? `1.0-${outExpr}` : outExpr};`);
    }

    if(node.type==='math'){
      const a = resolveInput(node.id,'a','0',context);
      const b = resolveInput(node.id,'b','0',context);
      const c = resolveInput(node.id,'c','0',context);
      const d = resolveInput(node.id,'d','0',context);
      // t: 시간 입력. 소켓이 연결돼 있으면 그 상류 수식을 그대로 쓰고, 미연결이면 timeSource
      // 필드로 선택한 emitter_age(이미터 전역 경과시간) 또는 particle_age(개별 파티클 생존시간,
      // v5부터 유효) 전역변수를 자동으로 흘려보낸다. Unity VFX Graph의 Time Operator/Unreal
      // Niagara의 Engine Time 모듈과 동일한 역할 — Vortex/Attractor 등의 strength·radius
      // 입력에 이 Formula를 연결하면 시간에 따라 값이 변조되는 힘을 만들 수 있다.
      const tFallback = node.data.timeSource==='particle_age' ? 'v.particle_age' : 'v.emitter_age';
      const t = resolveInput(node.id,'t', tFallback, context);
      let out;
      try{
        // [v8-5-4] dt = 이 Formula가 Accumulate 적분 안에서 평가될 때의 한 스텝 길이(초). 그 밖에서는 1/60.
        //   벽 보정처럼 "한 스텝에 b-c만큼 정확히 옮기기"는 a+(b-c)/dt 로 쓰면 스텝이 커도 튀지 않는다.
        out = compileFormula(node.data.expr||'0', { a, b, c, d, t, dt: (subOpts&&((subOpts.dtFormulaFor&&subOpts.dtFormulaFor(node.id))||subOpts.dtFormula||subOpts.dtVar)) ? ((subOpts.dtFormulaFor&&subOpts.dtFormulaFor(node.id))||subOpts.dtFormula||subOpts.dtVar) : DT60() });
      }catch(err){ errors.push(`Formula 노드(${node.id}) 수식 오류: ${err.message}`); return; }
      const vout = varNameFor(node.id,'out',context);
      lines.push(`${vout}=${out};`);
    }
  });

  if(errors.length) return {errors};

  return {
    emitter, count, lines, outputs: outputs[0], order,
  };
}

// Perlin 3D 노이즈를 Molang 문자열로 전개 (보내주신 예제 알고리즘 재사용)
function perlinNoiseMolang(px,py,pz,seedVar,ns){
  const g = (suffix, ox, oy, oz) => {
    return `v.${ns}hn=math.abs(math.sin((v.${ns}x0${ox?('+'+ox+'.0'):''})*127.1+(v.${ns}y0${oy?('+'+oy+'.0'):''})*311.7+(v.${ns}z0${oz?('+'+oz+'.0'):''})*74.7+${seedVar}*19.19)*43758.5453);`+
      `v.${ns}gx=math.cos(v.${ns}hn*360.0);v.${ns}gy=math.sin(v.${ns}hn*360.0);v.${ns}gz=math.cos(v.${ns}hn*721.0);`+
      `v.${ns}${suffix}=v.${ns}gx*(v.${ns}fx${ox?'-1.0':''})+v.${ns}gy*(v.${ns}fy${oy?'-1.0':''})+v.${ns}gz*(v.${ns}fz${oz?'-1.0':''});`;
  };
  let s = '';
  s += `v.${ns}x0=math.floor(${px});v.${ns}y0=math.floor(${py});v.${ns}z0=math.floor(${pz});`;
  s += `v.${ns}fx=${px}-v.${ns}x0;v.${ns}fy=${py}-v.${ns}y0;v.${ns}fz=${pz}-v.${ns}z0;`;
  s += `v.${ns}sx=math.hermite_blend(v.${ns}fx);v.${ns}sy=math.hermite_blend(v.${ns}fy);v.${ns}sz=math.hermite_blend(v.${ns}fz);`;
  s += g('n000',0,0,0) + g('n100',1,0,0) + g('n010',0,1,0) + g('n110',1,1,0);
  s += g('n001',0,0,1) + g('n101',1,0,1) + g('n011',0,1,1) + g('n111',1,1,1);
  s += `v.${ns}a=math.lerp(v.${ns}n000,v.${ns}n100,v.${ns}sx);v.${ns}b=math.lerp(v.${ns}n010,v.${ns}n110,v.${ns}sx);`;
  s += `v.${ns}c=math.lerp(v.${ns}n001,v.${ns}n101,v.${ns}sx);v.${ns}d=math.lerp(v.${ns}n011,v.${ns}n111,v.${ns}sx);`;
  s += `v.${ns}a=math.lerp(v.${ns}a,v.${ns}b,v.${ns}sy);v.${ns}b=math.lerp(v.${ns}c,v.${ns}d,v.${ns}sy);`;
  s += `v.${ns}noise=math.lerp(v.${ns}a,v.${ns}b,v.${ns}sz);`;
  return s;
}

// Simplex 노이즈(근사) — Molang 버전. 3D 스큐(skew) 좌표로 격자를 삼각/사면체 형태로 기울여
// perlin과 달리 축방향으로 도드라지는 격자 아티팩트가 덜 보이게 만든다. Bedrock Molang에는
// 배열/루프가 없으므로 8개 격자점 기여도를 전부 펼쳐서 더하는 형태로 전개한다.
function simplexNoiseMolang(px,py,pz,seedVar,ns){
  let s = '';
  s += `v.${ns}sk=(${px}+${py}+${pz})/3.0;`;
  s += `v.${ns}i=math.floor(${px}+v.${ns}sk);v.${ns}j=math.floor(${py}+v.${ns}sk);v.${ns}k=math.floor(${pz}+v.${ns}sk);`;
  s += `v.${ns}t=(v.${ns}i+v.${ns}j+v.${ns}k)/6.0;`;
  s += `v.${ns}x0=${px}-(v.${ns}i-v.${ns}t);v.${ns}y0=${py}-(v.${ns}j-v.${ns}t);v.${ns}z0=${pz}-(v.${ns}k-v.${ns}t);`;
  s += `v.${ns}sum=0.0;v.${ns}wsum=0.0;`;
  for(let dx=0; dx<=1; dx++) for(let dy=0; dy<=1; dy++) for(let dz=0; dz<=1; dz++){
    const suf = `${dx}${dy}${dz}`;
    s += `v.${ns}gx${suf}=v.${ns}x0-${dx}.0;v.${ns}gy${suf}=v.${ns}y0-${dy}.0;v.${ns}gz${suf}=v.${ns}z0-${dz}.0;`;
    s += `v.${ns}t2${suf}=0.6-v.${ns}gx${suf}*v.${ns}gx${suf}-v.${ns}gy${suf}*v.${ns}gy${suf}-v.${ns}gz${suf}*v.${ns}gz${suf};`;
    s += `v.${ns}t2${suf}=math.max(0.0,v.${ns}t2${suf});`;
    s += `v.${ns}hn${suf}=math.abs(math.sin((v.${ns}i+${dx}.0)*127.1+(v.${ns}j+${dy}.0)*311.7+(v.${ns}k+${dz}.0)*74.7+(${seedVar}*1.7+3.0)*19.19)*43758.5453);`;
    s += `v.${ns}gcx${suf}=math.cos(v.${ns}hn${suf}*360.0);v.${ns}gcy${suf}=math.sin(v.${ns}hn${suf}*360.0);v.${ns}gcz${suf}=math.cos(v.${ns}hn${suf}*721.0);`;
    s += `v.${ns}t4${suf}=v.${ns}t2${suf}*v.${ns}t2${suf}*v.${ns}t2${suf}*v.${ns}t2${suf};`;
    s += `v.${ns}contrib${suf}=v.${ns}t4${suf}*(v.${ns}gcx${suf}*v.${ns}gx${suf}+v.${ns}gcy${suf}*v.${ns}gy${suf}+v.${ns}gcz${suf}*v.${ns}gz${suf});`;
    s += `v.${ns}sum=v.${ns}sum+v.${ns}contrib${suf};v.${ns}wsum=v.${ns}wsum+v.${ns}t4${suf};`;
  }
  s += `v.${ns}noise=(v.${ns}wsum>0.0)?(v.${ns}sum/v.${ns}wsum*2.2):0.0;`;
  return s;
}

// Voronoi/Cellular(Worley) 노이즈 — Molang 버전. 주변 3x3x3 격자 셀마다 무작위 씨앗점을 하나씩
// 두고, 그중 가장 가까운 거리(과 두번째로 가까운 거리)를 구해 균열/비늘 같은 각진 경계 패턴을 만든다.
// smooth>0이면 최소/차소 거리를 섞어 경계를 부드럽게(칼각 대신 둥글게) 만든다.
function voronoiNoiseMolang(px,py,pz,seedVar,ns,density,smooth){
  let s = '';
  s += `v.${ns}sx=(${px})*${density};v.${ns}sy=(${py})*${density};v.${ns}sz=(${pz})*${density};`;
  s += `v.${ns}cx=math.floor(v.${ns}sx);v.${ns}cy=math.floor(v.${ns}sy);v.${ns}cz=math.floor(v.${ns}sz);`;
  s += `v.${ns}best=99999.0;v.${ns}second=99999.0;`;
  for(let dx=-1; dx<=1; dx++) for(let dy=-1; dy<=1; dy++) for(let dz=-1; dz<=1; dz++){
    const suf = `n${dx<0?'m1':dx}${dy<0?'m1':dy}${dz<0?'m1':dz}`.replace(/-/g,'m');
    const gx=`(v.${ns}cx+(${dx}.0))`, gy=`(v.${ns}cy+(${dy}.0))`, gz=`(v.${ns}cz+(${dz}.0))`;
    // 최적화: jx/jy/jz 세 해시가 공통으로 쓰는 gx*127.1+gy*311.7+gz*74.7 부분식을 셀당
    // 한 번만 계산해 변수(hbase)에 저장하고 재사용한다. 기존에는 이 부분식(곱셈 3+덧셈2)이
    // jx/jy/jz 각각에서 통째로 다시 평가돼 셀당 9번 곱셈+6번 덧셈이 들었는데, 이제 3번+2번으로
    // 줄어든다(seed 오프셋 덧셈만 해시별로 따로 유지 — 결과값은 연산 순서까지 완전히 동일해
    // 부동소수점 결과가 100% 일치한다). gx/gy/gz 자체도 변수로 한 번만 평가한다.
    const gxv=`v.${ns}gxc${suf}`, gyv=`v.${ns}gyc${suf}`, gzv=`v.${ns}gzc${suf}`;
    const hbase = `v.${ns}hb${suf}`;
    s += `${gxv}=${gx};${gyv}=${gy};${gzv}=${gz};`;
    s += `${hbase}=${gxv}*127.1+${gyv}*311.7+${gzv}*74.7;`;
    s += `v.${ns}jx${suf}=math.abs(math.sin(${hbase}+(${seedVar}*3.0+1.0)*19.19)*43758.5453);v.${ns}jx${suf}=v.${ns}jx${suf}-math.floor(v.${ns}jx${suf});`;
    s += `v.${ns}jy${suf}=math.abs(math.sin(${hbase}+(${seedVar}*3.0+7.0)*19.19)*43758.5453);v.${ns}jy${suf}=v.${ns}jy${suf}-math.floor(v.${ns}jy${suf});`;
    s += `v.${ns}jz${suf}=math.abs(math.sin(${hbase}+(${seedVar}*3.0+13.0)*19.19)*43758.5453);v.${ns}jz${suf}=v.${ns}jz${suf}-math.floor(v.${ns}jz${suf});`;
    s += `v.${ns}px${suf}=${gxv}+v.${ns}jx${suf};v.${ns}py${suf}=${gyv}+v.${ns}jy${suf};v.${ns}pz${suf}=${gzv}+v.${ns}jz${suf};`;
    s += `v.${ns}d${suf}=math.sqrt((v.${ns}sx-v.${ns}px${suf})*(v.${ns}sx-v.${ns}px${suf})+(v.${ns}sy-v.${ns}py${suf})*(v.${ns}sy-v.${ns}py${suf})+(v.${ns}sz-v.${ns}pz${suf})*(v.${ns}sz-v.${ns}pz${suf}));`;
    s += `v.${ns}second=(v.${ns}d${suf}<v.${ns}best)?v.${ns}best:((v.${ns}d${suf}<v.${ns}second)?v.${ns}d${suf}:v.${ns}second);`;
    s += `v.${ns}best=(v.${ns}d${suf}<v.${ns}best)?v.${ns}d${suf}:v.${ns}best;`;
  }
  s += `v.${ns}vraw=v.${ns}best+(v.${ns}second-v.${ns}best)*${smooth}*0.5;`;
  s += `v.${ns}noise=v.${ns}vraw*2.0-1.0;`; // 0~1 근방 거리값을 -1~1 스케일로 맞춰 다른 노이즈 타입과 amplitude 감각을 통일
  return s;
}

// FBM(Fractal Brownian Motion) — Molang 버전. perlinNoiseMolang을 octaves번 호출해서 겹치고,
// 각 옥타브마다 주파수는 lacunarity배, 진폭은 gain배로 조정한 뒤 가중평균한다.
function fbmNoiseMolang(px,py,pz,seedVar,ns,octaves,lacunarity,gain){
  let s = '';
  s += `v.${ns}famp=1.0;v.${ns}ffreq=1.0;v.${ns}fsum=0.0;v.${ns}fnorm=0.0;`;
  for(let o=0;o<octaves;o++){
    const sub = `${ns}o${o}`;
    s += perlinNoiseMolang(`(${px})*v.${ns}ffreq`, `(${py})*v.${ns}ffreq`, `(${pz})*v.${ns}ffreq`, `(${seedVar}+${o*11}.0)`, sub);
    s += `v.${ns}fsum=v.${ns}fsum+v.${sub}noise*v.${ns}famp;v.${ns}fnorm=v.${ns}fnorm+v.${ns}famp;`;
    s += `v.${ns}famp=v.${ns}famp*${gain};v.${ns}ffreq=v.${ns}ffreq*${lacunarity};`;
  }
  s += `v.${ns}noise=(v.${ns}fnorm>0.0)?(v.${ns}fsum/v.${ns}fnorm):0.0;`;
  return s;
}

// 완전 분산형에서는 noise3d가 다른 noise3d의 x/y/z/seed 입력에 체이닝되는 것도 자유롭다
// (양쪽 노드 모두 필요한 컨텍스트에서 나란히 재계산되므로 슬롯 예산 같은 제약이 없다).
// 유일하게 막아야 할 것은 그래프 자체의 순환 참조(사이클) — 위상 정렬(buildGraph의 order 계산)이
// 무한루프에 빠지지 않도록 미리 잡아낸다.
function validateNoCycles(){
  const errors = [];
  const nodes = Object.values(state.nodes);
  const WHITE=0, GRAY=1, BLACK=2;
  const color = new Map(nodes.map(n=>[n.id, WHITE]));
  function dfs(n){
    color.set(n.id, GRAY);
    const def = NODE_DEFS[n.type];
    for(const s of nodeAllInputs(n.type, n)){
      const w = findWireInto(n.id, s.k);
      if(!w) continue;
      if(isFeedbackWire(n.id, s.k)) continue; // [v8-2-4] Accumulate 경유 피드백은 한 프레임 지연이라 허용
      const fromNode = state.nodes[w.from.node];
      if(!fromNode) continue;
      const c = color.get(fromNode.id);
      if(c===GRAY){ errors.push(`그래프에 순환 참조가 있습니다(노드 ${n.id} ↔ ${fromNode.id} 근방). 연결을 확인하세요.`); continue; }
      if(c===WHITE) dfs(fromNode);
    }
    color.set(n.id, BLACK);
  }
  nodes.forEach(n=>{ if(color.get(n.id)===WHITE) dfs(n); });
  return [...new Set(errors)];
}

// [v8-4] 실제 Bedrock은 "한 번도 대입되지 않은 v.* 변수"를 읽는 순간 식 전체를 중단(abort)시키고
// "unhandled request for unknown variable" 오류를 낸다(에디터 프리뷰는 미정의=0으로 조용히 처리해서 못 잡던 문제).
// Accumulate의 상태변수(v.ac…s / …pa)와 피드백 간선(이전 프레임 값 읽기)이 대표적 — 첫 프레임에 읽기가
// 대입보다 먼저 나온다. 각 식을 순서대로 훑어 "대입되기 전에 읽힌 변수"를 찾아 creation_expression에서
// 0으로 미리 초기화해 준다(파티클은 스폰 시 이미터 변수를 복사해 가므로 파티클별 초기 상태가 된다).
function collectUninitVars(exprs, predefined){
  const bad = new Set(), userV = userConstVars();
  const builtin = /^v\.(particle_age|particle_random_[1-4]|emitter_age|emitter_random_[1-4]|particle_lifetime|emitter_lifetime)$/;
  for(const ex of exprs){
    if(typeof ex!=='string') continue;
    const defined = new Set(predefined);
    for(let st of ex.split(';')){
      st = st.trim(); if(!st) continue;
      const m = /^(v\.[A-Za-z0-9_]+)\s*=(?!=)([\s\S]*)$/.exec(st);
      const rhs = m ? m[2] : st;
      (rhs.match(/\bv\.[A-Za-z0-9_]+/g)||[]).forEach(r=>{ if(!builtin.test(r) && !defined.has(r) && !userV.has(r.slice(2))) bad.add(r); }); // 사용자 변수(상수 노드 v.이름)는 0으로 초기화하지 않음 — 게임이 넣은 값을 덮어쓰지 않도록
      if(m) defined.add(m[1]);
    }
  }
  return [...bad];
}
function collectAssignedVars(src){
  return new Set([...String(src).matchAll(/(?:^|;)\s*(v\.[A-Za-z0-9_]+)\s*=(?!=)/g)].map(m=>m[1]));
}

// 단일 (Sub)Emitter + 거기 연결된 Output 하나를 완결된 particle_effect JSON 하나로 컴파일한다.
// extraEvents: 이 이미터에 걸린 Event 노드들이 만들어내는 { eventName: eventBody } 쌍들 —
// emitter_lifetime_events의 creation_event/expiration_event/timeline과 최상위 events 블록에 병합된다.
// extraEvents.particle: Particle Event 노드들 { defs, creation, expiration, timeline } — particle_lifetime_events로 들어간다.
let _wallHist = new Map(); // [v10.5] 적분 루프 안 벽 노드의 직전 위치 변수(루프 밖 최종 벽 적용이 같은 이력을 쓰도록)
function generateParticleJSON(identifier, emitter, outputNode, extraEvents, splitOpts){
  _wallHist = new Map();
  extraEvents = extraEvents || { creation:[], expiration:[], timeline:{}, eventDefs:{} };
  const cycleErrors = validateNoCycles();
  if(cycleErrors.length) return { errors: cycleErrors };

  const gOff = buildGraph('off', emitter, outputNode, splitOpts);
  if(gOff.errors) return { errors:gOff.errors };
  const gFrame = buildGraph('frame', emitter, outputNode, splitOpts); // size + tint(r/g/b/a) — 완전 분산형: 파티클마다 통째로 재계산
  if(gFrame.errors) return { errors:gFrame.errors };

  // frame 컨텍스트는 출력식 자체에 노드 계산 라인을 포함시켜야 한다.
  // 첫 번째 frame 채널(R/size/UV 등)에서 한 번만 실행하고, 같은 컴포넌트의 나머지
  // 채널은 이미 계산된 v.fr... 변수를 그대로 참조한다.
  const wrapFrame = (expr)=> gFrame.lines.join('') + expr;
  // [fix] size용: 프레임 그래프 전체를 복사하면 JSON이 크게 늘어나므로, size 식이 실제로 의존하는 줄만 남긴다.
  // loop/중괄호, 대입이 아닌 문장이 있으면 안전하게 전체 줄을 그대로 붙인다.
  // [1.1.5] 필요한 줄만 남기는 일을 frame 줄(size·uv·rotation)과 motion 줄(direction) 모두에 쓰도록 일반화했다.
  const pruneLines = (all, expr)=>{
    try{
      if(/[{}]/.test(all) || /\bloop\s*\(/.test(all)) return all + expr;
      const key=(p,n)=>((/^t/i.test(p)?'t.':'v.')+n).toLowerCase();
      const refs=(str)=>{ const r=[]; str.replace(/\b(variable|v|temp|t)\.(\w+)/gi,(m,p,n)=>{ r.push(key(p,n)); return m; }); return r; };
      const defs=[];
      for(const st of all.split(';').map(x=>x.trim()).filter(Boolean)){
        const m=/^(variable|v|temp|t)\.(\w+)\s*=(?!=)([\s\S]*)$/i.exec(st);
        if(!m) return all + expr;
        defs.push({ k:key(m[1],m[2]), s:st, deps:refs(m[3]) });
      }
      const need=new Set(refs(expr)); let ch=true;
      while(ch){ ch=false; for(const d of defs){ if(need.has(d.k)) for(const x of d.deps) if(!need.has(x)){ need.add(x); ch=true; } } }
      return defs.filter(d=>need.has(d.k)).map(d=>d.s+';').join('') + expr;
    }catch(e){ return all + expr; }
  };
  const wrapFrameMin = (expr)=> pruneLines(gFrame.lines.join(''), expr);

  const { count } = gOff;
  const ed = emitter.data;

  // v5: creation_expression. rate_instant(1회 스폰) 전환으로 세대 순환(v.j 무한증가/리셋)이
  // 완전히 사라져 emitter 전역 변수 초기화가 훨씬 단순해졌다. v.j는 이제 "이번 이미터가
  // 지금까지 스폰한 파티클 수"를 세는 단순 증가 카운터일 뿐이며(0~n-1), 다시 리셋되지 않는다
  // (rate_instant는 딱 한 번만 n개를 스폰하므로 리셋할 필요 자체가 없다).
  const steady = ed.emitMode==='steady';
  const lifeSec0 = Math.max(0.1, ed.lifetimeSeconds || 1);
  const pLife = steady ? Math.max(0.05, +ed.particleLife||1) : lifeSec0;
  let creation = `v.n=${count};v.h=${ed.height};v.seed=${ed.seed};v.j=0;v.kill=0;v.ore_pl=${pLife};`;

  // offset 표현식: emitter_shape_point offset은 이번 이미터가 스폰하는 n개 파티클 각각에
  // 대해 정확히 한 번씩 실행된다(rate_instant). v.i = v.j(스폰 순서, 0~n-1)가 파티클의
  // 평생 고유 id가 되며, 더 이상 mod 연산으로 접을 필요가 없다(세대 순환이 없으므로 v.j가
  // n을 넘길 일 자체가 없다). Shape/noise3d 등 off 컨텍스트 상류 노드들은 기존과 동일하게
  // 이 자리에서 1회 계산된다.
  const iDeriveLine = steady ? `v.i=math.mod(v.j,v.n);` : `v.i=v.j;`;
  const offsetLines = [`v.j=v.j+1;`, iDeriveLine, ...gOff.lines].join('');
  const offX = resolveInputGlobal(gOff.outputs.id,'offx','0','off');
  const offY = resolveInputGlobal(gOff.outputs.id,'offy','0','off');
  const offZ = resolveInputGlobal(gOff.outputs.id,'offz','0','off');

  // v5: id 인코딩 — 세대 플래그(sk)가 사라졌으므로 max_lifetime에는 id(v.i, 0~n-1)만 저장한다.
  // frame 컨텍스트는 tint/size를, 내부 motion 컨텍스트는 기존 offset 그래프를 매 프레임
  // 재평가한다. 둘 다 이 id를 복원해 Shape/noise 등의 상류를 파티클별로 다시 계산한다.
  // max_lifetime = 1000000 + id*100 + 99 (자릿수 밀림 방지 베이스 + id 정수 그대로 + 안전마진 태그)
  const maxLifetimeExpr = `1000000+v.i*100+99`;

  // -----------------------------------------------------------------------
  // 위치 제어: offset 그래프를 "가속도"로 적분하지 않는다.
  //
  // 이전 방식은 x(t)의 2차 차분을 linear_acceleration에 넣었기 때문에
  // Bedrock이 그 값을 다시 velocity에 적분했다. 그러면 목표 위치 x(t)가
  // 아니라 "가속도를 두 번 적분한 위치"가 되고, 특히 Noise처럼 연속적으로
  // 변하는 값에서는 작은 차이도 속도에 누적되어 파티클이 목표 범위를
  // 크게 벗어나는 문제가 생긴다.
  //
  // 여기서는 Bedrock의 particle_motion_parametric을 사용해
  //   p(t) = [offset.x(t), offset.y(t), offset.z(t)]
  // 자체를 매 프레임 직접 지정한다. 따라서 Noise가 -1~1이면
  //   p(t) = C + Noise(t)
  // 를 정확히 그대로 따른다. 별도의 속도/가속도 적분 누적이 없다.
  // 연속값, Curve, Noise, Shape 등 모든 offset 그래프에 동일하게 적용된다.
  // -----------------------------------------------------------------------
  const gMotion0 = buildGraph('motion0', emitter, outputNode, splitOpts);
  if(gMotion0.errors) return { errors:gMotion0.errors };

  const motionTimeVar = 'v.ore_motion0_t';
  const motion0Lines = (()=>{
    const body = gMotion0.lines.join('');
    return body.replace(/v\.emitter_age/g, motionTimeVar);
  })();

  const off0X = resolveInputGlobal(gMotion0.outputs.id,'offx','0','motion0');
  const off0Y = resolveInputGlobal(gMotion0.outputs.id,'offy','0','motion0');
  const off0Z = resolveInputGlobal(gMotion0.outputs.id,'offz','0','motion0');

  // emitter_shape_point는 위치를 담당하지 않고 파티클별 고유 id(v.i)만
  // 초기화한다. 실제 위치는 아래 parametric.relative_position이 매 프레임 지정한다.
  const spawnInitX = offsetLines + `return 0;`;
  const spawnInitY = `return 0;`;
  const spawnInitZ = `return 0;`;

  // X 식에서만 motion0 그래프(Shape/Noise/Math 등 offx·offy·offz 상류 전체)를 한 번
  // 실행해 v.* 전역 변수를 채워 둔다. Bedrock은 같은 컴포넌트의 배열 항목들을
  // (relative_position의 x→y→z 순서로) 차례로 평가하며 v.* 전역 변수를 공유하므로
  // (tinting 컴포넌트의 r→g/b/a가 이미 이 방식에 의존하는 것과 동일한 원리),
  // Y/Z 식은 재계산 없이 X가 채워 둔 결과 변수를 그대로 읽기만 하면 된다.
  // → Noise/Math 등 무거운 연산이 프레임당 3번이 아니라 1번만 실행된다.
  const parametricFrameLines =
    `v.ore_motion0_t=v.particle_age;` + motion0Lines;
  const paramXExpr = parametricFrameLines + `return ${off0X};`;
  const paramYExpr = `return ${off0Y};`;
  const paramZExpr = `return ${off0Z};`;

  // direction: Output의 direction.x/y/z 소켓 중 하나라도 연결되면 parametric.direction으로 내보낸다.
  // 같은 motion0 컨텍스트에서 평가되며, relative_position X 식이 먼저 돌며 채운 v.* 변수를 읽는다.
  const dirWired = ['dirx','diry','dirz'].some(k=>findWireInto(gMotion0.outputs.id,k));
  // [beta-1.1.5] direction.x/y/z는 각 축이 스스로 완결되는 식이어야 한다.
  // 이전(1.1.4)에는 `return <변수>;` 만 내보내 relative_position X 식이 채워 둔 v.mo0* 전역 변수를 읽기만 했다.
  // 그런데 direction은 relative_position과 별개의 식 배열(심지어 billboard.custom_direction으로도 복제됨)이라
  // 평가 시점/순서가 보장되지 않고, v.*는 파티클 간에 공유되므로 다른 파티클(또는 이전 프레임)의 값이 읽혔다.
  // (collectUninitVars가 이 읽기를 "미초기화"로 보고 creation에서 0으로 채워 버려 증상이 가려지기도 했다.)
  // → 각 축 식 앞에 v.fri(id 복원) + 시간 + 상류 노드 계산 줄을 붙여 파티클별로 처음부터 다시 계산한다.
  // 연결되지 않은 축은 상수 폴백이므로 계산 줄을 붙이지 않는다.
  const dirOut = dirWired ? ['dirx','diry','dirz'].map(k=>{
    const wired = !!findWireInto(gMotion0.outputs.id,k);
    const e = resolveInputGlobal(gMotion0.outputs.id,k,'0','motion0');
    return wired ? pruneLines(parametricFrameLines, `return ${e};`) : `return ${e};`; // [1.1.5] 필요한 줄만(전체 복사 시 ks에서 축마다 148KB)
  }) : null;
  const facingMode = ed.facingMode || 'rotate_xyz';
  const billboardDirMode = ed.billboardDirMode || 'none';
  const needsDirMode = /^(lookat_direction|direction_x|direction_y|direction_z)$/.test(facingMode);
  if(needsDirMode && !dirWired && billboardDirMode==='none'){
    return { errors:[`facing_camera_mode "${facingMode}"는 방향 벡터가 필요합니다. Output의 direction.x/y/z 소켓을 연결하거나, Emitter의 billboard direction.mode를 지정하세요.`] };
  }
  if(billboardDirMode==='custom' && !dirWired){
    return { errors:['billboard direction.mode가 custom이지만 Output의 direction.x/y/z 소켓이 연결되어 있지 않습니다.'] };
  }
  const billboardDirection = billboardDirMode==='derive_from_velocity'
    ? { mode:'derive_from_velocity', min_speed_threshold: ed.minSpeedThreshold!==undefined?ed.minSpeedThreshold:0.01 }
    : billboardDirMode==='custom'
      ? { mode:'custom', custom_direction: dirOut.slice() }
      : null;

  // tinting: r/g/b/a는 그래프 배선(Output.tint.* 입력)을 그대로 따른다. Bedrock 파티클 변수(v.*)는
  // 파티클 전체에 걸쳐 전역이므로, frameLines(노드 그래프 전체 재계산)는 이펙트 전체를 통틀어
  // 딱 한 번만 실행하면 되고 이후 모든 채널(tint의 G/B/A, size, UV)은 그 결과 변수를 그대로
  // 재사용한다. 컴포넌트별 실행 순서는 tinting → billboard(size/uv) 순으로 고정되어 있으므로
  // (아래 particleJSON.components 선언 순서 참고), R 채널에서 한 번 실행해 두면 뒤따르는
  // billboard 컴포넌트에서도 안전하게 재사용할 수 있다.
  const tintExprR = resolveInputGlobal(gFrame.outputs.id,'r','1','frame');
  const tintExprG = resolveInputGlobal(gFrame.outputs.id,'g','0','frame');
  const tintExprB = resolveInputGlobal(gFrame.outputs.id,'b','0','frame');
  const tintExprA = resolveInputGlobal(gFrame.outputs.id,'a','1','frame');
  // frameLines가 붙으면(즉 gFrame.lines가 비어있지 않으면) 전체가 ';'로 끝나는 복합 표현식이
  // 되므로 Bedrock 규칙상 반드시 return으로 끝나야 한다(단순 상수/변수 하나만 있는 경우엔
  // frameLines가 비어 있어 return 없이도 유효하므로 그 경우엔 감싸지 않는다).
  const tintExprRFull = gFrame.lines.length ? `${wrapFrame(`return ${tintExprR};`)}` : tintExprR;
  const tintExprGFull = tintExprG;
  const tintExprBFull = tintExprB;
  const tintExprAFull = tintExprA;

  // billboard(size): tinting 컴포넌트가 이미 frameLines를 실행해 결과 변수를 채워 뒀으므로
  // (v.* 전역 변수 재사용), 여기서는 다시 실행하지 않고 값만 참조한다.
  // size_x/size_y는 서로 독립된 소켓 — 한쪽만 연결해도 나머지는 기본값(0.2)으로 폴백.
  const sizeXVal = resolveInputGlobal(gFrame.outputs.id,'size_x', null, 'frame');
  const sizeYVal = resolveInputGlobal(gFrame.outputs.id,'size_y', null, 'frame');
  // [fix] size도 tinting이 채워 둔 v.z1t/v.z1u 같은 변수에 기대면, 컴포넌트 평가 순서/파티클 간 변수 공유 때문에
  // 면 크기가 다른 면에 붙는다(비정육면체 박스가 깨짐). rotation처럼 노드 계산 줄을 함께 붙여 스스로 완결되게 만든다.
  const sizeXExpr = sizeXVal!==null ? (gFrame.lines.length ? wrapFrameMin(`return ${sizeXVal};`) : `return ${sizeXVal};`) : null;
  // [v1.1.3] rotation: 매 프레임 계산(frame 그래프). 움직임 컴포넌트는 tinting보다 먼저 평가될 수 있어서
  // tinting이 채워 둔 변수에 기대지 않고, 필요한 노드 계산 줄을 함께 붙여 스스로 완결되게 만든다.
  const rotWired = !!findWireInto(gFrame.outputs.id,'rot');
  const rotVal = rotWired ? resolveInputGlobal(gFrame.outputs.id,'rot','0','frame') : null;
  const rotExpr = rotWired ? (gFrame.lines.length ? wrapFrameMin(`return ${rotVal};`) : rotVal) : null;
  const sizeYExpr = sizeYVal!==null ? (gFrame.lines.length ? wrapFrameMin(`return ${sizeYVal};`) : `return ${sizeYVal};`) : null;

  // UV: 마찬가지로 tinting 컴포넌트에서 이미 채워둔 결과 변수를 재사용하므로 별도 실행이 필요 없다.
  const uvXVal = resolveInputGlobal(gFrame.outputs.id,'uvx', null, 'frame');
  const uvYVal = resolveInputGlobal(gFrame.outputs.id,'uvy', null, 'frame');
  const uvWVal = resolveInputGlobal(gFrame.outputs.id,'uvw', null, 'frame');
  const uvHVal = resolveInputGlobal(gFrame.outputs.id,'uvh', null, 'frame');
  // [1.1.5] UV도 size와 같은 billboard 컴포넌트라 tinting이 채운 변수에 기대면 평가 순서에 따라 틀린 값을 읽는다 → 스스로 완결되는 식으로.
  const uvSelf = v => (v!==null && gFrame.lines.length) ? wrapFrameMin(`return ${v};`) : v;
  const uvXExpr = uvXVal!==null ? uvSelf(uvXVal) : 0;
  const uvOut = [ uvXExpr, uvYVal!==null?uvSelf(uvYVal):0 ];
  const uvSizeOut = [ uvWVal!==null?uvSelf(uvWVal):(ed.textureWidth||16), uvHVal!==null?uvSelf(uvHVal):(ed.textureHeight||16) ];

  // kill: 파티클 개별 실제 수명. rate_instant + 실 수명 구조로 전환되면서 expiration_expression의
  // "세대 홀짝 판별" 로직이 필요 없어졌다 — max_lifetime 자체가 각 파티클의 진짜 남은 수명이므로
  // Bedrock이 알아서 그 시점에 파티클을 소멸시킨다. 이미터 자체의 kill(전체 이펙트 종료)은
  // 기존처럼 emitter_lifetime_events의 timeline으로 사용자가 지정한 수명(초) 시점에 발동한다.
  const lifeSec = Math.max(0.1, ed.lifetimeSeconds || 1);
  const killAt = pnum(steady ? (lifeSec+pLife) : lifeSec, Math.min(6, globalThis.ORE_PREC));
  const activeTime = steady
    ? (ed.steadyLoop ? lifeSec : Math.round((lifeSec+pLife+1)*100)/100)
    : Math.round((lifeSec+1)*100)/100;

  // events 블록: 항상 있는 kill 이벤트 + Event 노드들이 등록한 커스텀 이벤트(eventDefs)를 병합.
  // emitter_lifetime_events: kill용 timeline 항목에 Event 노드들의 creation_event/expiration_event/
  // timeline 항목을 병합한다 — 같은 컴포넌트 하나에 여러 트리거 종류가 공존 가능(Bedrock 스펙 그대로).
  const eventsBlock = Object.assign({ event: { expression: "v.kill = 1;" } }, extraEvents.eventDefs||{}, (extraEvents.particle&&extraEvents.particle.defs)||{});
  const lifetimeEvents = { timeline: Object.assign(steady&&ed.steadyLoop ? {} : { [killAt]: "event" }, extraEvents.timeline||{}) };
  if(extraEvents.creation && extraEvents.creation.length){
    lifetimeEvents.creation_event = extraEvents.creation.length===1 ? extraEvents.creation[0] : extraEvents.creation;
  }
  if(extraEvents.expiration && extraEvents.expiration.length){
    lifetimeEvents.expiration_event = extraEvents.expiration.length===1 ? extraEvents.expiration[0] : extraEvents.expiration;
  }

  // 킬 수식: Output의 life(particle_lifetime) 소켓이 연결되면 v.particle_age >= life 일 때 만료(Bedrock expiration_expression).
  // 노드 계산 라인(frameLines)이 필요하면 'return …;' 형태의 복합식으로 만든다.
  const lifeWired = !!findWireInto(gFrame.outputs.id,'life');
  let expirationExpr;
  if(lifeWired){
    const lifeE = resolveInputGlobal(gFrame.outputs.id,'life','0','frame');
    const cond = `v.kill||v.particle_age>=(${lifeE})`;
    expirationExpr = gFrame.lines.length ? `${gFrame.lines.join('')}return ${cond};` : cond;
  } else {
    expirationExpr = steady ? `v.kill||v.particle_age>=v.ore_pl` : "v.kill";
  }

  // [v8-4] 미초기화 변수 읽기 방지: 모든 식에서 "대입 전에 읽히는" v.* 를 찾아 creation_expression에서 0으로 초기화.
  {
    const creDefs = collectAssignedVars(creation);
    const spawnDefs = collectAssignedVars(spawnInitX);
    const partPre = new Set([...creDefs, ...spawnDefs]);
    const partExprs = [paramXExpr, paramYExpr, paramZExpr, ...(dirOut||[]),
      tintExprRFull, tintExprGFull, tintExprBFull, tintExprAFull, sizeXExpr, sizeYExpr, ...(rotExpr?[rotExpr]:[]),
      String(uvXExpr), String(uvOut[1]), String(uvSizeOut[0]), String(uvSizeOut[1]), expirationExpr];
    const need = [...new Set([
      ...collectUninitVars([spawnInitX], creDefs),
      ...collectUninitVars(partExprs, partPre)
    ])].filter(x=>!creDefs.has(x));
    if(need.length) creation += need.map(x=>`${x}=0;`).join('');
  }

  const particleJSON = {
    format_version: "1.10.0",
    particle_effect: {
      description: {
        identifier: identifier || "ore:generated_vfx",
        basic_render_parameters: {
          material: ed.material || "particles_add",
          texture: ed.texture || "textures/blocks/wool_colored_white"
        }
      },
      events: eventsBlock,
      components: {
        "minecraft:emitter_initialization": { creation_expression: creation },
        // v5: rate_instant — 이미터가 활성화되는 순간 n개를 딱 1회만 스폰한다(더 이상 초고속
        // 순환 재생성 없음). 파티클 개개인이 실제 수명(max_lifetime)을 가지고 자연스럽게
        // 소멸하는 표준적인 구조로 전환.
        ...(steady
          ? { "minecraft:emitter_rate_steady": {
                spawn_rate: ed.steadyLoop ? `${Math.max(0.1,+ed.spawnRate||30)}` : `(v.emitter_age<${pnum(lifeSec, Math.min(6, globalThis.ORE_PREC))})*${Math.max(0.1,+ed.spawnRate||30)}`,
                max_particles: Math.min(1000, Math.max(1, Math.round(+ed.maxParticles||200))) } }
          : { "minecraft:emitter_rate_instant": { num_particles: "v.n" } }),
        ...(steady && ed.steadyLoop
          ? { "minecraft:emitter_lifetime_looping": { active_time: activeTime, sleep_time: 0 } }
          : { "minecraft:emitter_lifetime_once": { active_time: activeTime } }),
        "minecraft:emitter_lifetime_events": lifetimeEvents,
        "minecraft:emitter_shape_point": {
          offset: [ spawnInitX, spawnInitY, spawnInitZ ]
        },
        "minecraft:particle_lifetime_expression": {
          max_lifetime: maxLifetimeExpr,
          expiration_expression: expirationExpr
        },
        "minecraft:particle_initial_speed": 0,
        // 위치를 물리 적분하지 않고 매 프레임 직접 지정한다.
        // relative_position은 emitter 기준 절대 목표 위치이므로
        // offset = 상수 + Noise(-1~1)라면 정확히 그 범위 안에 머문다.
        "minecraft:particle_motion_parametric": {
          relative_position: [ paramXExpr, paramYExpr, paramZExpr ]
        },
        // tinting을 billboard(size)보다 먼저 배치(가독성 목적 — 컴포넌트별로 각자 frameLines를
        // 독립 실행하므로 순서 자체가 정확성에 영향을 주지는 않는다).
        "minecraft:particle_appearance_tinting": {
          color: [ tintExprRFull, tintExprGFull, tintExprBFull, tintExprAFull ]
        },
        "minecraft:particle_appearance_billboard": {
          size: [ sizeXVal!==null ? sizeXExpr : 0.2, sizeYVal!==null ? sizeYExpr : 0.2 ],
          facing_camera_mode: facingMode,
          uv: { texture_width: ed.textureWidth||16, texture_height: ed.textureHeight||16, uv: uvOut, uv_size: uvSizeOut }
        }
      }
    }
  };

  {
    const comps = particleJSON.particle_effect.components;
    if(rotWired) comps["minecraft:particle_motion_parametric"].rotation = rotExpr;
    if(dirOut) comps["minecraft:particle_motion_parametric"].direction = dirOut;
    if(billboardDirection) comps["minecraft:particle_appearance_billboard"].direction = billboardDirection;
    // [v1.0.12] 로케이터 부착용 기준 공간 — 켰을 때만 넣는다(rotation=true면 position도 true여야 함).
    if(ed.localSpace) comps["minecraft:emitter_local_space"] = { position: !!(ed.lsPosition||ed.lsRotation), rotation: !!ed.lsRotation, velocity: !!ed.lsVelocity };
    // [v1.0.12] 파티클 개별 이벤트 (Particle Event 노드)
    const pe = extraEvents.particle;
    if(pe && (pe.creation.length || pe.expiration.length || Object.keys(pe.timeline).length)){
      const ple = {};
      if(pe.creation.length) ple.creation_event = pe.creation.length===1 ? pe.creation[0] : pe.creation.slice();
      if(pe.expiration.length) ple.expiration_event = pe.expiration.length===1 ? pe.expiration[0] : pe.expiration.slice();
      if(Object.keys(pe.timeline).length) ple.timeline = Object.assign({}, pe.timeline);
      comps["minecraft:particle_lifetime_events"] = ple;
    }
  }

  // 마인크래프트 베드락 파티클은 이미터 1개당 실사용 가능한 파티클 수에 한계가 있다.
  // v5: linear_acceleration 전환 + rate_instant로 초고속 순환 재생성이 사라져 렉/재계산 부담이
  // 크게 줄었으므로 안전선을 500 → 1000으로 상향(요청사항). count(로컬 스폰 개수)는 항상 1000
  // 이하로 들어온다(generateAllParticleJSONs에서 1000 단위로 미리 분할해서 넘겨주기 때문).
  // 방어적으로 한 번 더 확인.
  if(count>1000){
    return { errors:[`내부 오류: 분산 이미터 분할 후에도 로컬 count(${count})가 1000을 초과했습니다.`] };
  }

  shortenVarNames(particleJSON); // [v10.2]
  return { json: particleJSON };
}

// [v10.2] 내보낸 JSON 안의 긴 내부 변수 이름(예: v.wlmoG0n71__wall1_t0)을 짧은 이름(v.z1a)으로 일괄 치환한다.
// Accumulate 적분은 그래프를 스텝 수만큼 복사하므로 식 길이의 대부분이 변수 이름이었고, 55KB 상한 때문에 분할 수가 6 정도로 묶였다.
// 한 이펙트 안에서 같은 이름은 같은 짧은 이름으로 바뀌므로 동작은 그대로다. 내장 변수(particle_age 등)와
// 다른 이펙트와 주고받는 이름(pre_effect_expression에 나오는 이름), 7자 미만의 짧은 이름은 그대로 둔다.
// [v10.7] 상수 노드의 마인크래프트 변수 연결: value에 "v.이름" 또는 "variable.이름"을 쓰면 그 Molang 변수를 그대로 읽는다.
// 스크립트(MolangVariableMap)나 엔티티 쪽에서 값을 넣어 이펙트를 바깥에서 조절할 수 있게 하기 위한 것.
// 에디터 미리보기에는 그 변수가 없으므로 previewValue를 대신 쓴다(내보낸 JSON에는 들어가지 않음).
function constVarName(d){
  const m = /^\s*(?:v|variable)\.([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(String(d && d.value!==undefined ? d.value : ''));
  return m ? m[1] : null;
}
const CONST_RESERVED = /^(n|h|j|i|seed|fri|kill|parent_[xyz]|particle_age|particle_lifetime|particle_random_[1-4]|emitter_age|emitter_lifetime|emitter_random_[1-4])$/;
function userConstVars(){
  const m = new Map();
  Object.values(state.nodes).forEach(n=>{ if(n.type==='constant'){ const nm=constVarName(n.data); if(nm) m.set(nm, Number.isFinite(+n.data.previewValue)?+n.data.previewValue:0); } });
  return m;
}
function shortenVarNames(json){
  const pe = json && json.particle_effect; if(!pe) return;
  const KEEP = /^(particle_age|particle_lifetime|particle_random_[1-4]|emitter_age|emitter_lifetime|emitter_random_[1-4])$/;
  const userV = userConstVars(); // 사용자 변수는 이름을 바꾸지 않는다(마인크래프트 쪽에서 그 이름으로 값을 넣음)
  const refs = [], cross = new Set();
  (function walk(o, key){
    for(const k in o){
      const v = o[k];
      if(typeof v==='string'){ refs.push([o,k]); if(k==='pre_effect_expression') (v.match(/\bv\.[A-Za-z_]\w*/g)||[]).forEach(m=>cross.add(m.slice(2))); }
      else if(v && typeof v==='object') walk(v, k);
    }
  })({c:pe.components, e:pe.events});
  const cnt = new Map();
  refs.forEach(([o,k])=>{ (o[k].match(/\bv\.[A-Za-z_]\w*/g)||[]).forEach(m=>{ const n=m.slice(2); cnt.set(n,(cnt.get(n)||0)+1); }); });
  const names = [...cnt.keys()].filter(n=>n.length>=7 && !KEEP.test(n) && !cross.has(n) && !userV.has(n)).sort((a,b)=>cnt.get(b)-cnt.get(a));
  if(!names.length) return;
  const map = new Map(); let id = 0;
  for(const n of names){ let sn; do{ sn = 'z'+(id++).toString(36); } while(cnt.has(sn)); map.set(n, sn); }
  refs.forEach(([o,k])=>{ o[k] = o[k].replace(/\bv\.([A-Za-z_]\w*)/g, (m,n)=> map.has(n) ? 'v.'+map.get(n) : m); });
}
// output 노드는 buildGraph 내부 클로저 밖에서도 참조해야 하므로 전역 resolveInput 래퍼
function resolveInputGlobal(nodeId, socketKey, fallback, context){
  return resolveInput(nodeId, socketKey, fallback, context);
}

/* -------------------------------------------------------------------------
   8.5 Sub Emitter / Event 그래프 조립
   구조: (Emitter 또는 Sub Emitter) --trigger--> Event --fire--> Sub Emitter --trigger--> Event --fire--> ...
   각 (Sub)Emitter는 자신에게 연결된 Output 하나를 찾아 독립된 particle_effect JSON으로 컴파일된다.
   Event 노드는 JSON을 만들지 않는다 — 대신 부모 (Sub)Emitter의 events/emitter_lifetime_events에
   "자식 Sub Emitter를 스폰하는 이벤트 항목"을 추가하는 역할만 한다.
   ------------------------------------------------------------------------- */

// 주어진 (Sub)Emitter 노드에서 출발해, 그 출력(j/n/h/seed/bone 아무 소켓이나) 중 하나가
// Output 노드의 입력에 (직접 또는 간접적으로) 연결되어 있는지를 찾는다.
// 원본 그래프는 "Output 입력 -> 역추적"이 자연스러운 방향이므로, 반대로 모든 Output에 대해
// buildGraph의 위상탐색을 이 emitter까지 거슬러 갈 수 있는지 검사하는 방식으로 매칭한다.
function findOutputForEmitter(emitterNode){
  const outputs = Object.values(state.nodes).filter(n=>n.type==='output');
  for(const out of outputs){
    const def = NODE_DEFS['output'];
    const seen = new Set();
    const queue = [];
    def.inputs.forEach(s=>{
      const w = findWireInto(out.id, s.k);
      if(w) queue.push(w.from.node);
    });
    while(queue.length){
      const nid = queue.shift();
      if(seen.has(nid)) continue;
      seen.add(nid);
      if(nid===emitterNode.id) return out;
      const n = state.nodes[nid];
      if(!n) continue;
      const ndef = NODE_DEFS[n.type];
      nodeAllInputs(n.type, n).forEach(s=>{
        const w = findWireInto(n.id, s.k);
        if(w) queue.push(w.from.node);
      });
    }
  }
  return null;
}

// Event 노드의 trigger 입력에 연결된 (Emitter/Sub Emitter) 부모 노드를 찾는다.
function findEventParent(eventNode){
  const w = findWireInto(eventNode.id, 'trigger');
  if(!w) return null;
  const n = state.nodes[w.from.node];
  if(n && (n.type==='emitter' || n.type==='sub_emitter')) return n;
  return null;
}

// (Sub)Emitter의 fire 출력을 구독하는 Event 노드들을 찾는다(하나의 이미터가 여러 이벤트를 가질 수 있음).
function findEventsTriggeredBy(emitterOrSubNode){
  return Object.values(state.nodes).filter(n=>{
    if(n.type!=='event') return false;
    const w = findWireInto(n.id,'trigger');
    return w && w.from.node===emitterOrSubNode.id;
  });
}

// Event 노드의 fire 출력에 연결된 Sub Emitter들을 찾는다(반드시 trigger 입력으로 연결된 것만).
function findSubEmittersFiredBy(eventNode){
  return Object.values(state.wires)
    .filter(w=>w.from.node===eventNode.id && w.from.socket==='fire' && w.to.socket==='trigger')
    .map(w=>state.nodes[w.to.node])
    .filter(n=>n && n.type==='sub_emitter');
}

// 두 (Sub)Emitter 사이의 bone 배선 여부: subNode의 bone 입력에 parentNode의 bone 출력이
// 연결되어 있으면, Bedrock 이벤트 type을 emitter_bound로 내보내 같은 본에 붙게 한다.
function subEmitterInheritsBone(subNode){
  const w = findWireInto(subNode.id, 'bone');
  return !!w; // 연결 자체가 있으면 상속(값 자체는 Bedrock에서 부착 시 자동으로 같은 locator를 씀)
}

// [v1.0.12] Particle Event 노드 찾기 / 변환
function findParticleEventsTriggeredBy(emitterOrSubNode){
  return Object.values(state.nodes).filter(n=>{
    if(n.type!=='particle_event') return false;
    const w = findWireInto(n.id,'trigger');
    return w && w.from.node===emitterOrSubNode.id;
  });
}
// 발동 시 할 일을 모아 Bedrock 이벤트 하나로 만든다. 할 일이 둘 이상이면 sequence로 묶는다. 할 일이 없으면 null.
function compileParticleEventNode(node, childIdentifiers){
  const d = node.data, parts = [];
  const type = d.spawnType==='emitter_bound' ? 'emitter_bound' : 'emitter';
  childIdentifiers.forEach(cid=>{ if(cid) parts.push({ particle_effect:{ effect: cid, type } }); });
  const snd = String(d.sound||'').trim(); if(snd) parts.push({ sound_effect:{ event_name: snd } });
  const ex = String(d.expr||'').trim(); if(ex) parts.push({ expression: /;\s*$/.test(ex) ? ex : ex+';' });
  if(!parts.length) return null;
  return { name: 'pevt_'+safeIdTag(node.id), body: parts.length===1 ? parts[0] : { sequence: parts } };
}
// [v1.0.12] 이미터 식별자 정리: 비었으면 ''(자동 사용), 콜론이 없으면 기본 네임스페이스를 붙인다. 형식이 틀리면 {error}.
function normParticleId(raw, baseIdentifier){
  let s = String(raw||'').trim().toLowerCase();
  if(!s) return '';
  if(!s.includes(':')) s = String(baseIdentifier||'ore:x').split(':')[0] + ':' + s;
  if(!/^[a-z0-9_.]+:[a-z0-9_.]+$/.test(s)) return { error:'"namespace:name" 형식, 소문자·숫자·_·. 만 쓸 수 있습니다' };
  return s;
}

function safeEventName(nodeId){
  return 'evt_'+safeIdTag(nodeId);
}

// Event 노드 하나를 (부모 identifier, 자식 identifier) 기준으로 Bedrock 이벤트 정의로 변환.
function compileEventNode(eventNode, childIdentifier){
  const d = eventNode.data;
  const evtName = safeEventName(eventNode.id);
  const preLines = [];
  if(d.copySeed) preLines.push('v.seed=v.seed;'); // 값은 이미 부모 스코프에 있는 v.seed를 그대로 참조(문서화 목적의 no-op에 가까움)
  if(d.copyPos) preLines.push('v.parent_x=v.of'+safeIdTag(eventNode.id)+'_x;'); // 위치 복사가 필요한 경우를 위한 자리(그래프 배선에 따라 실제 변수명은 달라질 수 있음)
  if(d.copyColor) preLines.push('v.parent_tint_copied=1;');
  const type = d.bindToBone ? 'emitter_bound' : 'emitter';
  const body = {
    particle_effect: {
      effect: childIdentifier,
      type: type,
    }
  };
  if(preLines.length) body.particle_effect.pre_effect_expression = preLines.join('');
  return { name: evtName, body };
}

// 캔버스 전체를 스캔해서 (Emitter, Sub Emitter) 각각을 독립 JSON으로 컴파일하고,
// Event 체인을 따라 부모 JSON에 "자식을 스폰하는 이벤트"를 삽입한다.
// baseIdentifier: 최상위(Emitter) 파일의 identifier. Sub Emitter들은 "_sub_<safeId>" 접미사로 파생.
function generateAllParticleJSONs(baseIdentifier){
  const errors = [];
  const nodes = Object.values(state.nodes);
  const rootEmitters = nodes.filter(n=>n.type==='emitter');
  const subEmitters = nodes.filter(n=>n.type==='sub_emitter');

  if(rootEmitters.length===0) errors.push('Emitter 노드가 없습니다. 팔레트에서 추가하세요.');
  if(rootEmitters.length>1) errors.push('최상위 Emitter 노드는 하나만 사용할 수 있습니다 (v1.0 제한).');
  if(errors.length) return { errors };

  const cycleErrors = validateNoCycles();
  if(cycleErrors.length) return { errors: cycleErrors };

  // 모든 (Sub)Emitter에 identifier 미리 배정 (Event가 자식 identifier를 참조해야 하므로 먼저 계산)
  // [v1.0.12] 이미터에 식별자를 직접 적었으면 그것을 쓰고, 비어 있으면 예전 자동 이름을 쓴다(기존 그래프 출력 불변).
  const identifierOf = new Map();
  const pickId = (n, auto)=>{ const r = normParticleId(n.data.particleId, baseIdentifier); if(r && r.error){ errors.push(`${n.type==='emitter'?'Emitter':'Sub Emitter'}(${n.id}) 식별자 "${n.data.particleId}": ${r.error}`); return auto; } return r || auto; };
  identifierOf.set(rootEmitters[0].id, pickId(rootEmitters[0], baseIdentifier));
  subEmitters.forEach(se=>{ identifierOf.set(se.id, pickId(se, `${baseIdentifier}_sub_${safeIdTag(se.id)}`)); });
  { const seen = new Map(); identifierOf.forEach((v,k)=>{ if(seen.has(v)) errors.push(`식별자 "${v}"를 두 이미터(${seen.get(v)}, ${k})가 같이 쓰고 있습니다. 서로 다르게 바꿔주세요.`); else seen.set(v,k); }); }
  if(errors.length) return { errors };

  const results = []; // { identifier, json, nodeId }
  const allEmitterLikeNodes = [rootEmitters[0], ...subEmitters];

  for(const emNode of allEmitterLikeNodes){
    const outNode = findOutputForEmitter(emNode);
    if(!outNode){
      errors.push(`${emNode.type==='emitter'?'Emitter':'Sub Emitter'}(${emNode.id})에 연결된 Output 노드가 없습니다.`);
      continue;
    }

    // 이 이미터의 fire 대상 Event들을 모아서 emitter_lifetime_events / events 블록에 병합할 데이터 구성.
    const extraEvents = { creation:[], expiration:[], timeline:{}, eventDefs:{} };
    const eventsHere = findEventsTriggeredBy(emNode);
    eventsHere.forEach(evNode=>{
      const children = findSubEmittersFiredBy(evNode);
      if(children.length===0) return; // fire에 아무것도 안 붙어있으면 이벤트를 만들 필요 없음
      if(evNode.data.bindToBone){
        children.forEach(c=>{
          if(!subEmitterInheritsBone(c)){
            errors.push(`Event(${evNode.id})는 "발동원의 bone에 부착"이 켜져 있지만, Sub Emitter(${c.id})의 bone 입력이 연결되어 있지 않습니다. 상류 Emitter/Sub Emitter의 bone 출력을 이 Sub Emitter의 bone 입력에 연결하거나, 체크박스를 해제하세요.`);
          }
        });
      }
      // Event 하나에 여러 Sub Emitter가 연결된 경우, 그 이벤트가 발동될 때 전부 같이 스폰되도록
      // sequence로 묶는다(발동 조건은 하나지만 결과가 여러개인 케이스).
      const childIdentifiers = children.map(c=>identifierOf.get(c.id));
      const compiled = childIdentifiers.map(cid=>compileEventNode(evNode, cid));
      // 같은 evNode 이름 하나에 sequence로 다 몰아넣는다(compiled[i].name은 전부 동일하므로 첫번째만 사용).
      const evtName = compiled[0].name;
      const evtBody = compiled.length===1
        ? compiled[0].body
        : { sequence: compiled.map(c=>c.body) };
      extraEvents.eventDefs[evtName] = evtBody;
      const d = evNode.data;
      if(d.condition==='creation') extraEvents.creation.push(evtName);
      else if(d.condition==='expiration') extraEvents.expiration.push(evtName);
      else if(d.condition==='timeline'){
        const t = pnum(Math.max(0, d.timelineTime||0), Math.min(6, globalThis.ORE_PREC));
        // 같은 시각에 여러 이벤트가 겹칠 수 있으므로 배열로 누적
        if(extraEvents.timeline[t]){
          if(Array.isArray(extraEvents.timeline[t])) extraEvents.timeline[t].push(evtName);
          else extraEvents.timeline[t] = [extraEvents.timeline[t], evtName];
        } else {
          extraEvents.timeline[t] = evtName;
        }
      }
    });

    // [v1.0.12] Particle Event: 이 이미터의 "파티클"에 붙는 이벤트. 분할된 파일(_2, _3…)의 파티클도 같은 파티클이므로 모든 조각에 똑같이 넣는다.
    const particleEv = { defs:{}, creation:[], expiration:[], timeline:{} };
    findParticleEventsTriggeredBy(emNode).forEach(pev=>{
      const c = compileParticleEventNode(pev, findSubEmittersFiredBy(pev).map(ch=>identifierOf.get(ch.id)));
      if(!c) return;
      particleEv.defs[c.name] = c.body;
      const d = pev.data;
      if(d.condition==='creation') particleEv.creation.push(c.name);
      else if(d.condition==='timeline'){ const t = pnum(Math.max(0, +d.timelineTime||0), Math.min(6, globalThis.ORE_PREC)); const cur = particleEv.timeline[t]; particleEv.timeline[t] = cur ? [].concat(cur, c.name) : c.name; }
      else particleEv.expiration.push(c.name);
    });
    extraEvents.particle = particleEv;

    const identifier = identifierOf.get(emNode.id);

    // 1000개 초과 count 자동 분할(v5: 500 → 1000 상향): linear_acceleration 전환 + rate_instant로
    // 초고속 순환 재생성이 사라져 렉/재계산 부담이 줄었으므로, 이미터 1개당 안전하게 뽑을 수
    // 있는 파티클 수를 500 → 1000으로 상향했다. count가 1000을 넘으면 이 이미터를
    // "원본 + 분산 이미터 여러 개"로 쪼개서 여러 개의 particle_effect JSON으로 나눠 낸다.
    // 예) count=2400 → 1000(원본) + 1000(_2) + 400(_3), 총 3개 파일.
    // 각 분산 파일은 buildGraph에 splitOpts(localCount/globalN/jOffset)를 넘겨, 나선/도형
    // 수식이 참조하는 j/n은 "전역(=전체 2400개 기준)" 인덱스로 이어지게 만든다 — 즉 파일이
    // 여러 개로 쪼개져도 시각적으로는 하나의 연속된 도형처럼 보인다.
    const totalCount = Math.max(1, Math.round(emNode.data.count||1));
    const CHUNK = 1000;
    const numChunks = (emNode.data.emitMode==='steady') ? 1 : Math.ceil(totalCount / CHUNK);

    if(numChunks<=1){
      // 1000개 이하면 기존과 동일하게 단일 파일.
      const res = generateParticleJSON(identifier, emNode, outNode, extraEvents);
      if(res.errors){ errors.push(...res.errors); continue; }
      results.push({ identifier, json: res.json, nodeId: emNode.id, isSub: emNode.type==='sub_emitter' });
      continue;
    }

    // 원본(첫 청크)이 스폰될 때 나머지 분산 이미터들도 동시에 함께 스폰되도록, 원본의
    // creation 이벤트 목록에 자동 이벤트를 하나 추가한다(사용자가 직접 Event/Sub Emitter
    // 노드를 그리지 않아도 됨 — export 시점에만 내부적으로 생성되는 가상의 이벤트).
    const autoEvtName = 'evt_autosplit_'+safeIdTag(emNode.id);
    const splitChildBodies = [];
    let hadError = false;

    for(let c=0; c<numChunks; c++){
      const jOffset = c*CHUNK;
      const localCount = Math.min(CHUNK, totalCount - jOffset);
      const chunkIdentifier = c===0 ? identifier : `${identifier}_${c+1}`;
      const splitOpts = { localCount, globalN: totalCount, jOffset };
      // 원본(c===0)에는 기존 extraEvents(사용자가 그린 Event 체인)를 그대로 유지하고,
      // 분산 파일(c>0)에는 자기 자신을 소환할 이벤트가 필요 없으므로 빈 extraEvents만 준다
      // (분산 파일 자신은 원본의 creation 이벤트에 의해 소환되는 "자식"이지, 스스로 다른
      // Sub Emitter를 발동시키는 이벤트 체인의 일부가 아니기 때문 — 단, 원본에 걸린 Event가
      // "원본 스폰 시" 조건이라면 분산 파일과는 무관하므로 그대로 원본에만 남긴다).
      const evForThisChunk = c===0 ? extraEvents : { creation:[], expiration:[], timeline:{}, eventDefs:{}, particle: particleEv };
      const res = generateParticleJSON(chunkIdentifier, emNode, outNode, evForThisChunk, splitOpts);
      if(res.errors){ errors.push(...res.errors); hadError = true; continue; }
      results.push({
        identifier: chunkIdentifier, json: res.json, nodeId: emNode.id,
        isSub: emNode.type==='sub_emitter', isSplit: c>0, splitOf: identifier,
      });
      if(c>0){
        splitChildBodies.push({ particle_effect: { effect: chunkIdentifier, type: 'emitter' } });
      }
    }
    if(hadError) continue;

    // 원본(첫 청크) JSON에 자동 소환 이벤트를 사후 삽입: creation 시점에 나머지 분산 파일들이
    // sequence로 한꺼번에 스폰되도록 events / emitter_lifetime_events.creation_event를 병합.
    if(splitChildBodies.length){
      const rootResult = results.find(r=>r.identifier===identifier && !r.isSplit && r.nodeId===emNode.id);
      if(rootResult){
        const pe = rootResult.json.particle_effect;
        pe.events = pe.events || {};
        pe.events[autoEvtName] = splitChildBodies.length===1
          ? splitChildBodies[0]
          : { sequence: splitChildBodies };
        pe.components["minecraft:emitter_lifetime_events"] = pe.components["minecraft:emitter_lifetime_events"] || { timeline:{} };
        const lte = pe.components["minecraft:emitter_lifetime_events"];
        if(lte.creation_event){
          const existing = Array.isArray(lte.creation_event) ? lte.creation_event : [lte.creation_event];
          lte.creation_event = [...existing, autoEvtName];
        } else {
          lte.creation_event = autoEvtName;
        }
      }
    }
  }

  // [v10.7] 상수 노드 변수 검사: 예약 이름이거나, 내보낸 식 안에서 같은 이름에 값을 대입하는 곳이 있으면(내부 변수와 충돌) 오류.
  const uvs = userConstVars();
  globalThis.__oreUserVarVals = Object.fromEntries(uvs);
  uvs.forEach((pv,nm)=>{
    if(CONST_RESERVED.test(nm)) { errors.push(`상수 노드의 v.${nm} 은(는) 예약된 이름이라 쓸 수 없습니다. 다른 이름을 쓰세요.`); return; }
    const re = new RegExp(`\\bv(?:ariable)?\\.${nm}\\s*=(?!=)`);
    if(results.some(x=>{ let hit=false; const w=o=>{ if(hit) return; if(typeof o==='string'){ if(re.test(o)) hit=true; } else if(o&&typeof o==='object') for(const k in o) w(o[k]); }; w(x.json); return hit; }))
      errors.push(`상수 노드의 v.${nm} 이(가) 에디터 내부 변수 이름과 겹칩니다. 다른 이름(예: v.my_${nm})을 쓰세요.`);
  });
  if(errors.length) return { errors: [...new Set(errors)] };
  return { results };
}

/* ===== ORE Sim v1: 컴파일된 Bedrock JSON을 직접 시뮬레이션 (3D 프리뷰 · 디버거 · 검사기 · .mcpack) ===== */
const OreSimCore=(function(){
const RAD=Math.PI/180, MM={sin:a=>Math.sin(a*RAD),cos:a=>Math.cos(a*RAD),tan:a=>Math.tan(a*RAD),asin:a=>Math.asin(a)/RAD,acos:a=>Math.acos(a)/RAD,atan:a=>Math.atan(a)/RAD,atan2:(a,b)=>Math.atan2(a,b)/RAD,abs:Math.abs,sqrt:Math.sqrt,pow:Math.pow,floor:Math.floor,ceil:Math.ceil,round:Math.round,trunc:Math.trunc,min:Math.min,max:Math.max,exp:Math.exp,ln:Math.log,random:(a=0,b=1)=>a+Math.random()*(b-a),mod:(a,b)=>a%b,lerp:(a,b,t)=>a+(b-a)*t,clamp:(v,a,b)=>Math.min(Math.max(v,a),b),hermite_blend:t=>3*t*t-2*t*t*t,pi:Math.PI};
let cache={}, cacheN=0, cacheChars=0;
// [메모리 누수 수정] 식 문자열을 키로 한 컴파일 캐시가 무제한으로 쌓여, samples/벽 크기를 바꿀 때마다
// (수십~수백KB짜리 식 + 컴파일된 함수가) 계속 남아 메모리가 불어났다. 개수/총 길이 상한을 두고 넘으면 비운다.
function cachePut(src,fn){ if(cacheN>=300||cacheChars+src.length>6e6){ cache={}; cacheN=0; cacheChars=0; } cacheN++; cacheChars+=src.length; return cache[src]=fn; }
{const EI={sine:t=>1-Math.cos(t*Math.PI/2),quad:t=>t*t,cubic:t=>t**3,quart:t=>t**4,quint:t=>t**5,expo:t=>t===0?0:Math.pow(2,10*t-10),circ:t=>1-Math.sqrt(1-t*t)};
for(const k in EI){const f=EI[k];MM['ease_in_'+k]=(a,b,t)=>a+(b-a)*f(t);MM['ease_out_'+k]=(a,b,t)=>a+(b-a)*(1-f(1-t));MM['ease_in_out_'+k]=(a,b,t)=>a+(b-a)*(t<.5?f(2*t)/2:1-f(2-2*t)/2);}
Object.assign(MM,{sign:v=>v>0?1:-1,inverse_lerp:(a,b,v)=>b===a?0:(v-a)/(b-a),min_angle:v=>{v=((v%360)+360)%360;return v>=180?v-360:v;},copy_sign:(a,b)=>Math.abs(a)*(b<0?-1:1),random_integer:(a,b)=>Math.floor(a+Math.random()*(b-a+1)),die_roll:(n,a,b)=>{let s=0;for(let i=0;i<n;i++)s+=a+Math.random()*(b-a);return s;},die_roll_integer:(n,a,b)=>{let s=0;for(let i=0;i<n;i++)s+=Math.floor(a+Math.random()*(b-a+1));return s;}});}
function molang(src){
  src=String(src); if(cache[src]) return cache[src];
  if(globalThis.__oreLegacyEval) return molangLegacy(src);
  // [v10.3 최적화] 변수를 지역 변수로 옮겨 계산하고 끝에서 한 번만 V에 되돌려 쓴다(V는 속성이 수백 개라 매번 객체에 읽고 쓰는 게 느리고,
  // 숫자를 쓸 때마다 힙에 상자를 만들어 GC가 잦았다). 연산 순서와 값은 이전과 같다.
  if(globalThis.OreOpt&&OreOpt.on!==false&&OreOpt.toJSFast&&src.length<60000){let js=null;try{js=OreOpt.toJSFast(src);}catch(e){if(e&&e.message&&/math\./.test(e.message))throw e;}
   if(js){const f=new Function('V','Q','M','T','D','N',js);return cachePut(src,(V,Q,M,T)=>f(V,Q,M,T,_D,_N));}}
  return molangLegacy(src, true);
}
const _D=(a,b)=>b===0?0:a/b, _N=v=>(v===undefined||v!==v)?0:v;
// 이전 평가 경로(그대로 보존). estCost의 "검증 예상 시간" 판단이 예전과 같은 기준으로 나오도록 거기서만 쓴다.
let cacheL={}, cacheLN=0;
function molangLegacy(src, shared){
  src=String(src);
  const C = shared ? cache : cacheL;
  if(C[src]) return C[src];
  const put=(fn)=>{ if(shared) return cachePut(src,fn); if(cacheLN>=300){ cacheL={}; cacheLN=0; } cacheLN++; return cacheL[src]=fn; };
  if(globalThis.OreOpt&&OreOpt.on!==false&&OreOpt.toJS&&src.length<60000){let js=null;try{js=OreOpt.toJS(src);}catch(e){if(e&&e.message&&/math\./.test(e.message))throw e;}
   if(js)return put(new Function('V','Q','M','T','const D=(a,b)=>b===0?0:a/b,N=v=>(v===undefined||v!==v)?0:v;return (function(){'+js+'\n})()'));}
  let s=src.replace(/\b(?:variable|v)\.(\w+)/g,'V.$1').replace(/\b(?:query|q)\.(\w+)/g,'Q.$1').replace(/\b(?:temp|t)\.(\w+)/g,'T.$1').replace(/\bmath\.(\w+)/g,(m,n)=>{if(!(n in MM)) throw new Error('알 수 없는 math.'+n);return 'M.'+n;});
  s=s.replace(/\bloop\s*\(([^,]+),\s*\{/g,'for(let __i=0;__i<($1);__i++){');
  const body=/\breturn\b|;/.test(s)?s:'return ('+s+');';
  const fn=new Function('V','Q','M','T','return (function(){'+body+'\n})()');
  return put(fn);
}
const run=(src,V,Q,T)=>{const r=molang(src)(V,Q,MM,T||{}); return typeof r==='boolean'?+r:r;};
const num=(x,d=0)=>(typeof x==='number'&&isFinite(x))?x:d;
function ev(x,V,Q){return typeof x==='number'?x:run(x,V,Q);}

function build(json, pre){
  const c=json.particle_effect.components, E={}, Q={};
  if(globalThis.__oreUserVarVals) Object.assign(E, globalThis.__oreUserVarVals); // [v10.7] 상수 노드 변수의 미리보기 값
  if(pre){ try{ run(pre,E,Q); }catch(e){} } // [v1.1] ALL 재생: 이벤트의 pre_effect_expression(새 이미터에서 먼저 실행)
  const init=c['minecraft:emitter_initialization'];
  if(init&&init.creation_expression) run(init.creation_expression,E,Q);
  for(let k=1;k<=4;k++) E['emitter_random_'+k]=Math.random();
  const lp=c['minecraft:emitter_lifetime_looping'], lo=c['minecraft:emitter_lifetime_once'];
  E.emitter_lifetime=num(ev((lp||lo||{}).active_time,E,Q),0);
  const rs=c['minecraft:emitter_rate_steady'];
  const tl=(c['minecraft:emitter_lifetime_events']||{}).timeline||{}, ks=Object.keys(tl).map(Number).filter(isFinite);
  // [v1.1.1] 파티클을 끝내는 시각 = timeline 중 v.kill=1 이벤트가 걸린 시각. 예전엔 timeline의 가장 이른 시각을 써서,
  // Event 노드(타임라인)가 더 이른 시각에 걸려 있으면 미리보기에서 파티클이 그때 사라졌다. kill 이벤트를 못 찾으면 예전 방식.
  const evs=json.particle_effect.events||{}, isKill=n=>/v\.kill\s*=\s*1/.test(JSON.stringify(evs[n]||''));
  const kks=ks.filter(k=>{ const v=tl[Object.keys(tl).find(x=>+x===k)]; return (Array.isArray(v)?v:[v]).some(isKill); });
  const killAt=kks.length?Math.min(...kks):(ks.length?Math.min(...ks):1e9);
  const mat=(json.particle_effect.description.basic_render_parameters||{}).material||'';
  { const bb0=c['minecraft:particle_appearance_billboard']||{}; FACE.set(c, { face: bb0.facing_camera_mode||'rotate_xyz', bdir: bb0.direction||null }); }
  const mk=(V)=>{V.particle_random_1=Math.random();V.particle_random_2=Math.random();V.particle_random_3=Math.random();V.particle_random_4=Math.random();};
  if(rs){
    // 지속 생성: spawn_rate(Molang)를 1/60초 단위로 적분해 누적 생성 수 테이블을 만든다.
    const act=E.emitter_lifetime||1, loop=!!lp, H=Math.min(120,Math.max(5,(killAt<1e9?killAt:act*2)+2)), cum=[0];
    for(let k=0;k<H*60;k++){const V=Object.assign({},E); V.emitter_age=loop?(k/60)%act:k/60; Q.emitter_age=V.emitter_age; cum.push(cum[k]+Math.max(0,num(ev(rs.spawn_rate,V,Q),0))/60);}
    const spawnT=(n)=>{let lo2=0,hi=cum.length-1; if(cum[hi]<n+1) return Infinity; while(lo2<hi){const m=(lo2+hi)>>1; if(cum[m]>=n+1) hi=m; else lo2=m+1;} return lo2/60;};
    return {c,E,Q,n:num(E.n,1),ps:[],V0s:[],lastT:0,killAt,mat,steady:{cum,spawnT,max:Math.min(1000,Math.max(1,Math.round(num(ev(rs.max_particles,E,Q),200)))),cache:new Map(),loop,act},span:loop?act*2+0.5:undefined};
  }
  const n=Math.min(1000,Math.max(0,Math.round(num(ev(c['minecraft:emitter_rate_instant'].num_particles,E,Q),0))));
  const ps=[], V0s=[]; for(let i=0;i<n;i++){const V=Object.assign({},E); V.i=i;V.j=i;mk(V); V.particle_lifetime=ev(c['minecraft:particle_lifetime_expression'].max_lifetime,V,Q); V0s[i]=Object.assign({},V); ps.push(V);}
  const S1={c,E,Q,n,ps,V0s,lastT:0,killAt,mat}; S1.stateless=probeStateless(S1); return S1;
}
// [v8-5-4] Accumulate가 stateless(매 평가마다 id·시간에서 재계산)이면 시간을 건너뛰어도 결과가 같다.
// 그런 그래프는 슬라이더/프레임 점프 때 중간 프레임을 1/60초씩 따라잡는 보정(수십 배 연산)이 필요 없다.
// 첫 파티클을 "바로 0.6초" vs "0.3초 거쳐 0.6초"로 평가해 같은 값이면 stateless로 판정.
function probeStateless(S){
  try{
    if(!S.ps.length) return false;
    const mk=()=>Object.assign({},S.V0s[0]||S.ps[0]);
    const a=mk(), pa=evalOne(S,a,0,0.6,0.6);
    const b=mk(); evalOne(S,b,0,0.3,0.3); const pb=evalOne(S,b,0,0.6,0.6);
    if(pa.err||pb.err||!pa.pos||!pb.pos) return false;
    const same=(x,y)=>(x||[]).length===(y||[]).length&&(x||[]).every((v,i)=>Math.abs(v-y[i])<=1e-9*Math.max(1,Math.abs(v)));
    return same(pa.pos,pb.pos)&&same(pa.size,pb.size)&&same(pa.col,pb.col);
  }catch(e){return false;}
}
// [v1.1.4] 빌보드 방향 정보(facing_camera_mode · direction 블록)를 컴포넌트 객체별로 기억해 두고 evalOne이 파티클에 붙인다.
const FACE=new WeakMap();
function evalOne(S,V,i,t,age){
  const {c,Q}=S, mo=c['minecraft:particle_motion_parametric'], col=c['minecraft:particle_appearance_tinting'].color, bb=c['minecraft:particle_appearance_billboard'], ex=c['minecraft:particle_lifetime_expression'].expiration_expression;
  V.particle_age=age; V.emitter_age=S.steady&&S.steady.loop?t%S.steady.act:t; V.kill=t>=S.killAt?1:0; Q.particle_age=age; Q.emitter_age=V.emitter_age; Q.particle_lifetime=V.particle_lifetime;
  let p={i,V,alive:true,err:null};
  try{
    if(ex&&run(ex,V,Q)) p.alive=false;
    const g=a=>a.map(x=>num(ev(x,V,Q)));
    p.pos=g(mo.relative_position); if(mo.direction) p.dir=g(mo.direction); if(mo.rotation!==undefined) p.rot=num(ev(mo.rotation,V,Q));
    { const fi=FACE.get(c); if(fi){ p.face=fi.face; if(fi.bdir&&fi.bdir.mode!=='derive_from_velocity'&&Array.isArray(fi.bdir.custom_direction)) p.bdir=g(fi.bdir.custom_direction); } } p.size=g(bb.size); p.col=col.length===4?g(col):[1,1,1,1];
    p.uv=bb.uv&&bb.uv.uv?g(bb.uv.uv):[0,0]; p.uvs=bb.uv&&bb.uv.uv_size?g(bb.uv.uv_size):[16,16]; p.tw=bb.uv?bb.uv.texture_width:16; p.th=bb.uv?bb.uv.texture_height:16;
  }catch(e){p.err=e.message;p.alive=false;}
  return p;
}
function evalAt(S,t){
  const {c,Q,ps}=S, out=[]; Q.emitter_age=t; Q.particle_age=t;
  const stride=Math.max(1,(S.stride|0)||1); // [v8-5-4] 무거운 그래프는 N개 중 1개만 계산(경량 모드)
  const rewound=t<S.lastT-1e-9; const prevT=rewound?0:S.lastT; S.lastT=t;
  if(S.steady){
    const T=S.steady; if(rewound) T.cache.clear();
    // 지금까지 생성된 수 N(t) → 최근 max_particles개만 후보
    let N=0; {const idx=Math.min(T.cum.length-1,Math.floor(t*60+1e-6)); N=Math.floor(T.cum[idx]+1e-9);}
    const n=Math.max(1,S.n|0);
    for(let k=Math.max(0,N-T.max);k<N;k+=stride){
      const ts=T.spawnT(k); if(!(ts<=t)) continue;
      let V=T.cache.get(k);
      if(!V){V=Object.assign({},S.E); V.j=k+1; V.i=(k+1)%n; V.particle_random_1=Math.random();V.particle_random_2=Math.random();V.particle_random_3=Math.random();V.particle_random_4=Math.random(); V.particle_lifetime=ev(c['minecraft:particle_lifetime_expression'].max_lifetime,V,Q); T.cache.set(k,V);}
      const p=evalOne(S,V,k,t,t-ts); if(p.alive||p.err) out.push(p);
    }
    for(const k of T.cache.keys()) if(k<N-T.max-4) T.cache.delete(k);
    return out;
  }
  // 되감기(수명 초과 후 0초 복귀 / 슬라이더·리셋·이전 프레임) 시 Accumulate 등 상태 변수를 초기 상태로 복원
  if(rewound&&S.V0s){for(let i=0;i<ps.length;i++){const V=ps[i],V0=S.V0s[i];if(!V0)continue;for(const k in V){if(!(k in V0))delete V[k];}Object.assign(V,V0);}}
  // [v8-2-4] 슬라이더/스킵으로 시간이 크게 점프하면 Accumulate(오일러 적분)가 한 번에 큰 Δt로 튀어
  // 발산하므로, 1/60초 단위로 중간 프레임을 먼저 돌려 상태를 따라잡는다.
  if(t-prevT>1/30+1e-9 && stride===1 && !S.heavy && !S.stateless){ for(let tt=prevT+1/60; tt<t-1e-9; tt+=1/60){ for(let i=0;i<ps.length;i++) evalOne(S,ps[i],i,tt,tt); } }
  for(let i=0;i<ps.length;i+=stride) out.push(evalOne(S,ps[i],i,t,t));
  return out;
}
function validate(json){
  const iss=[], pe=json&&json.particle_effect; if(!pe) return [['error','particle_effect 블록이 없습니다.']];
  const c=pe.components||{}, d=pe.description||{};
  [c['minecraft:emitter_rate_steady']?'minecraft:emitter_rate_steady':'minecraft:emitter_rate_instant',c['minecraft:emitter_lifetime_looping']?'minecraft:emitter_lifetime_looping':'minecraft:emitter_lifetime_once','minecraft:particle_lifetime_expression','minecraft:particle_appearance_billboard'].forEach(k=>{if(!c[k]) iss.push(['error','필수 컴포넌트 누락: '+k]);});
  if(!d.identifier||!/^[a-z0-9_]+:[a-z0-9_]+$/.test(d.identifier)) iss.push(['error','identifier 형식이 올바르지 않습니다(예 ore:my_vfx).']);
  { const fm=((c['minecraft:particle_appearance_billboard']||{}).facing_camera_mode)||'';
    const OK=['rotate_xyz','rotate_y','lookat_xyz','lookat_y','lookat_direction','direction_x','direction_y','direction_z','emitter_transform_xy','emitter_transform_xz','emitter_transform_yz'];
    if(fm&&!OK.includes(fm)) iss.push(['error','알 수 없는 facing_camera_mode: '+fm]);
    if(/^(lookat_direction|direction_)/.test(fm)&&!(c['minecraft:particle_motion_parametric']||{}).direction&&!((c['minecraft:particle_appearance_billboard']||{}).direction)) iss.push(['warn',fm+' 모드에 방향 벡터가 없습니다.']); }
  const tex=(d.basic_render_parameters||{}).texture||''; if(!/^textures\//.test(tex)) iss.push(['warn','텍스처 경로가 textures/ 로 시작하지 않습니다: '+tex]);
  const assigned=new Set(), used=new Set(), B=new Set(['particle_age','particle_lifetime','emitter_age','particle_random_1','particle_random_2','particle_random_3','particle_random_4','emitter_random_1','emitter_random_2','emitter_random_3','emitter_random_4','emitter_lifetime','i','j']);
  const strs=[]; (function w(o,p){if(typeof o==='string') strs.push([p,o]); else if(o&&typeof o==='object') for(const k in o) w(o[k],p+'/'+k);})(c,'');
  const ev2=pe.events||{}; for(const k in ev2) if(ev2[k].expression) strs.push(['events/'+k,ev2[k].expression]);
  strs.forEach(([p,s])=>{ if(!/[a-z]\.|^\s*[\d.\-]/.test(s)&&!/^[\w. ]+$/.test(s)) return;
    try{molang(s);}catch(e){iss.push(['error',`Molang 오류 (${p.slice(-40)}): ${e.message}`]);}
    (s.match(/\b(?:v|variable)\.\w+\s*=(?!=)/g)||[]).forEach(m=>assigned.add(m.replace(/^\w+\./,'').replace(/\s*=$/,'')));
    (s.match(/\b(?:v|variable)\.\w+/g)||[]).forEach(m=>used.add(m.replace(/^\w+\./,'')));
    const o=(s.match(/\(/g)||[]).length-(s.match(/\)/g)||[]).length; if(o) iss.push(['error',`괄호 짝이 맞지 않습니다 (${p.slice(-40)})`]);});
  const UV = globalThis.__oreUserVarVals || {};
  used.forEach(u=>{if(!assigned.has(u)&&!B.has(u)){ if(u in UV) iss.push(['info','게임에서 값을 넣는 변수: v.'+u+' (미리보기 값 '+UV[u]+')']); else iss.push(['warn','정의되지 않은 변수 사용: v.'+u]); }});
  try{const S=build(json); if(S.n>1000) iss.push(['error','파티클 수가 1000을 초과']); S.stride=Math.max(1,Math.ceil((S.steady?S.steady.max:S.ps.length)/12)); const r=evalAt(S,0.3); S.stride=1; r.forEach(p=>{if(p.err) iss.push(['error','평가 오류(id '+p.i+'): '+p.err]);}); const bad=r.filter(p=>p.pos&&p.pos.some(v=>Math.abs(v)>500)).length; if(bad) iss.push(['warn',bad+'개 파티클이 원점에서 500블록 이상 벗어남']);}catch(e){iss.push(['error','시뮬레이션 불가: '+e.message]);}
  if(!iss.some(x=>x[0]!=='info')) iss.unshift(['ok','검사 통과: 구조·Molang 문법·변수·평가값 이상 없음']);
  return iss;
}
/* ---- ZIP(.mcpack) ---- */
const CT=(()=>{const t=[];for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0;}return t;})();
const crc=b=>{let c=~0;for(const x of b)c=CT[(c^x)&255]^(c>>>8);return ~c>>>0;};
function zip(files){const te=new TextEncoder(),parts=[],cd=[];let off=0;
  const u16=v=>[v&255,v>>8&255],u32=v=>[v&255,v>>8&255,v>>16&255,v>>24&255];
  files.forEach(f=>{const nm=te.encode(f.name),d=f.bin||te.encode(f.data),cr=crc(d);
    const h=[0x50,0x4b,3,4,20,0,0,8,0,0,0,0,0,0,...u32(cr),...u32(d.length),...u32(d.length),...u16(nm.length),0,0];
    parts.push(new Uint8Array(h),nm,d);
    cd.push(new Uint8Array([0x50,0x4b,1,2,20,0,20,0,0,8,0,0,0,0,0,0,...u32(cr),...u32(d.length),...u32(d.length),...u16(nm.length),0,0,0,0,0,0,0,0,0,0,0,0,...u32(off)]),nm);
    off+=h.length+nm.length+d.length;});
  const csz=cd.reduce((a,b)=>a+b.length,0);
  return new Blob([...parts,...cd,new Uint8Array([0x50,0x4b,5,6,0,0,0,0,...u16(files.length),...u16(files.length),...u32(csz),...u32(off),0,0])],{type:'application/zip'});}
return {RAD,MM,cachePut,molang,_D,_N,molangLegacy,run,num,ev,build,probeStateless,FACE,evalOne,evalAt,validate,CT,crc,zip};
})();
globalThis.OreSim={molang:OreSimCore.run,build:OreSimCore.build,evalAt:OreSimCore.evalAt,validate:OreSimCore.validate,MM:OreSimCore.MM,zip:OreSimCore.zip};

/* ===== ORE Opt v1: Molang 수식 최적화 (상수 접기 · 대수 단순화 · 공통식 제거 · 죽은 대입 제거 + 수치 동등성 검증) ===== */
(function(){
const MM=OreSim.MM, OPT=globalThis.OreOpt={on:true,level:2};
// maxEstMs: 검증 예상 시간이 이보다 길면 최적화를 건너뛴다(실제 실행 시간을 재므로 그때그때 결과가 달라질 수 있음).
// 웹은 기기가 멈추지 않도록 3000ms. 헤드리스(MCP)는 같은 그래프가 항상 같은 파일로 나오도록 Infinity로 끄고 크기 기준(40KB)만 쓴다.
OPT.maxEstMs=3000;
function tok(s){const r=[],re=/\s*(\d+\.?\d*(?:e[+-]?\d+)?|\.\d+|[A-Za-z_][\w.]*|<=|>=|==|!=|&&|\|\||[-+*\/<>!?:(),;=])/gy;let m;while(re.lastIndex<s.length&&(m=re.exec(s)))r.push(/^[A-Za-z_]/.test(m[1])?m[1].toLowerCase().replace(/^variable\./,'v.').replace(/^query\./,'q.').replace(/^temp\./,'t.'):m[1]);if(s.slice(re.lastIndex).trim())throw 0;return r;}
function parse(T){let p=0;const pk=()=>T[p],nx=()=>T[p++],L=[['||'],['&&'],['==','!='],['<','>','<=','>='],['+','-'],['*','/']];
 function bin(l){if(l===6)return un();let a=bin(l+1);while(L[l].includes(pk())){const o=nx();a={o,l:a,r:bin(l+1)};}return a;}
 function tern(){const c=bin(0);if(pk()==='?'){nx();const a=tern();if(nx()!==':')throw 0;return{c,a,b:tern()};}return c;}
 function un(){if(pk()==='-'||pk()==='!'){const o=nx();return{u:o,a:un()};}return pr();}
 function pr(){const t=nx();if(t==null)throw 0;if(t==='('){const e=tern();if(nx()!==')')throw 0;return e;}if(/^[\d.]/.test(t))return{n:+t};if(/^[a-z_]/.test(t)){if(pk()==='('){nx();const a=[];if(pk()!==')'){do{a.push(tern());}while(pk()===','&&nx());}if(nx()!==')')throw 0;return{f:t,a};}return{v:t};}throw 0;}
 const e=tern();if(p!==T.length)throw 0;return e;}
function stmts(s){const T=tok(s),out=[];let cur=[];T.concat([';']).forEach(t=>{if(t===';'){if(cur.length){if(cur[0]==='return')out.push({ret:1,e:parse(cur.slice(1))});else if(/^[vt]\./.test(cur[0])&&cur[1]==='=')out.push({as:cur[0],e:parse(cur.slice(2))});else out.push({e:parse(cur)});}cur=[];}else cur.push(t);});return {st:out,semi:T.includes(';')};}
const isN=x=>x.n!==undefined;
const LV=()=>OPT.level;
const FOLD=new Set('sin cos tan asin acos atan atan2 abs sqrt pow floor ceil trunc round min max exp ln mod lerp clamp hermite_blend sign inverse_lerp min_angle copy_sign'.split(' '));
const RNDF=/^math\.(random|die_roll)/,UNSAFEF=/^math\.(sqrt|pow|ln|asin|acos|exp|tan|mod|ease_)/,INTF=new Set(['math.floor','math.ceil','math.trunc','math.round']),CMP=new Set(['<','>','<=','>=','==','!=']);
const mk=(o,l,r)=>({o,l,r});
const cl=x=>x.n!==undefined||x.v!==undefined?{...x}:x.u?{u:x.u,a:cl(x.a)}:x.c?{c:cl(x.c),a:cl(x.a),b:cl(x.b)}:x.f?{f:x.f,a:x.a.map(cl)}:{o:x.o,l:cl(x.l),r:cl(x.r)};
const cP=P=>({st:P.st.map(s=>({...s,e:cl(s.e)})),semi:P.semi});
/* 순수(난수·미지 함수 없음) = 복제/삭제/순서변경해도 값과 난수열이 안 바뀜 · safe = 거기에 NaN/Inf 가능성도 없음 */
const pure=x=>x.n!==undefined||x.v!==undefined||(x.f?(x.f.startsWith('math.')&&!RNDF.test(x.f)&&x.a.every(pure)):kids(x).every(pure));
const safe=x=>pure(x)&&(function w(y){if(y.f&&UNSAFEF.test(y.f))return false;return kids(y).every(w);})(x);
const isBool=x=>!!(x.o&&(CMP.has(x.o)||x.o==='&&'||x.o==='||')||x.u==='!');
/* 구간 해석: 값의 범위를 알면 clamp/min/max/abs/비교 삼항을 통째로 제거 */
const RV={};['particle_random_1','particle_random_2','particle_random_3','particle_random_4','emitter_random_1','emitter_random_2','emitter_random_3','emitter_random_4'].forEach(n=>{RV['v.'+n]=[0,1];});
const I=[-Infinity,Infinity];
function rng(x){
 if(x.n!==undefined)return[x.n,x.n];
 if(x.v!==undefined)return x.v==='math.pi'?[Math.PI,Math.PI]:(RV[x.v]||null);
 if(x.u==='-'){const r=rng(x.a);return r&&[-r[1],-r[0]];}
 if(x.u==='!')return[0,1];
 if(x.c){const a=rng(x.a),b=rng(x.b);return a&&b?[Math.min(a[0],b[0]),Math.max(a[1],b[1])]:null;}
 if(x.f){if(!x.f.startsWith('math.'))return null;const n=x.f.slice(5),a=x.a.map(rng),g=i=>a[i]||I;
  if(n==='sin'||n==='cos')return[-1,1];
  if(n==='abs'){const r=g(0),m=Math.max(Math.abs(r[0]),Math.abs(r[1]));return[r[0]<=0&&r[1]>=0?0:Math.min(Math.abs(r[0]),Math.abs(r[1])),m];}
  if(n==='sqrt'&&a[0]&&a[0][0]>=0)return[Math.sqrt(a[0][0]),Math.sqrt(a[0][1])];
  if(n==='min'&&a.length===2)return[Math.min(g(0)[0],g(1)[0]),Math.min(g(0)[1],g(1)[1])];
  if(n==='max'&&a.length===2)return[Math.max(g(0)[0],g(1)[0]),Math.max(g(0)[1],g(1)[1])];
  if(n==='clamp'&&a.length===3&&a[1]&&a[2]&&a[1][0]===a[1][1]&&a[2][0]===a[2][1]&&a[1][0]<=a[2][0])return[a[1][0],a[2][0]];
  if(n==='hermite_blend'&&a[0]&&a[0][0]>=0&&a[0][1]<=1)return[0,1];
  if((n==='floor'||n==='ceil'||n==='trunc'||n==='round')&&a[0])return[MM[n](a[0][0]),MM[n](a[0][1])];
  return null;}
 if(CMP.has(x.o)||x.o==='&&'||x.o==='||')return[0,1];
 const l=rng(x.l),r=rng(x.r);if(!l||!r)return null;let v;
 if(x.o==='+')v=[l[0]+r[0],l[1]+r[1]];
 else if(x.o==='-')v=[l[0]-r[1],l[1]-r[0]];
 else if(x.o==='*'){const p=[l[0]*r[0],l[0]*r[1],l[1]*r[0],l[1]*r[1]];if(p.some(q=>q!==q))return null;v=[Math.min(...p),Math.max(...p)];}
 else if(x.o==='/'){if(r[0]<=0&&r[1]>=0)return null;const p=[l[0]/r[0],l[0]/r[1],l[1]/r[0],l[1]/r[1]];if(p.some(q=>q!==q))return null;v=[Math.min(...p),Math.max(...p)];}
 else return null;
 return v[0]!==v[0]||v[1]!==v[1]?null:v;}
function decide(c){
 if(!c.o||!CMP.has(c.o)||!pure(c))return null;const a=rng(c.l),b=rng(c.r);if(!a||!b)return null;
 const eq=a[0]===a[1]&&b[0]===b[1]&&a[0]===b[0],ne=a[1]<b[0]||a[0]>b[1];
 switch(c.o){case'<':return a[1]<b[0]?true:a[0]>=b[1]?false:null;case'>':return a[0]>b[1]?true:a[1]<=b[0]?false:null;
  case'<=':return a[1]<=b[0]?true:a[0]>b[1]?false:null;case'>=':return a[0]>=b[1]?true:a[1]<b[0]?false:null;
  case'==':return ne?false:eq?true:null;case'!=':return ne?true:eq?false:null;}return null;}
/* 합/곱 체인 정규화 */
function flat(x,sg,out){if(x.o==='+'){flat(x.l,sg,out);flat(x.r,sg,out);}else if(x.o==='-'){flat(x.l,sg,out);flat(x.r,-sg,out);}else if(x.u==='-')flat(x.a,-sg,out);else out.push([sg,x]);}
function fm(x,o){if(x.o==='*'){fm(x.l,o);fm(x.r,o);}else if(x.u==='-'){o.s=-o.s;fm(x.a,o);}else if(isN(x))o.c*=x.n;else o.f.push(x);}
const byKey=(p,q)=>{const a=key(p),b=key(q);return a<b?-1:a>b?1:0;};
const prodOf=f=>f.reduce((a,b)=>mk('*',a,b));
function factorPair(m){
 for(let i=0;i<m.length;i++)for(let j=i+1;j<m.length;j++){
  const A=m[i],B=m[j];if(!pure(A.b)||!pure(B.b))continue;
  const fa={c:1,s:1,f:[]},fb={c:1,s:1,f:[]};fm(A.b,fa);fm(B.b,fb);
  const ka=fa.f.map(key),kb=fb.f.map(key),ci=ka.findIndex(k=>kb.includes(k));if(ci<0)continue;
  const F=fa.f[ci],ra=fa.f.filter((_,t)=>t!==ci),rb=fb.f.slice();rb.splice(kb.indexOf(ka[ci]),1);
  const ia=A.k*fa.c*fa.s,ib=B.k*fb.c*fb.s;if(!isFinite(ia)||!isFinite(ib))continue;
  const na=ra.length?mk('*',prodOf(ra),{n:ia}):{n:ia},nb=rb.length?mk('*',prodOf(rb),{n:ib}):{n:ib};
  const cand=mk('*',F,RW(mk('+',na,nb)));
  const old=size(A.b)+size(B.b)+(Math.abs(A.k)!==1?2:0)+(Math.abs(B.k)!==1?2:0)+1;
  if(size(cand)<old){m[i]={k:1,b:cand};m.splice(j,1);return true;}}
 return false;}
function RWadd(x){
 const t=[];flat(x,1,t);let c=0;const ts=[];
 for(const[sg,e]of t){if(isN(e)){c+=sg*e.n;continue;}ts.push(e.o==='*'&&isN(e.r)?{k:sg*e.r.n,b:e.l}:{k:sg,b:e});}
 if(!isFinite(c))return x;
 let m=[];const idx=new Map();
 for(const q of ts){const kk=key(q.b),p=pure(q.b);if(p&&idx.has(kk))m[idx.get(kk)].k+=q.k;else{if(p)idx.set(kk,m.length);m.push({k:q.k,b:q.b});}}
 if(m.some(q=>!isFinite(q.k)))return x;
 for(let g=0;g<6&&factorPair(m);g++);
 for(let i=0;i<m.length;i++){const s=m[i];if(!s||!(s.b.o==='*'&&key(s.b.l)===key(s.b.r)&&s.b.l.f==='math.sin'&&pure(s.b)))continue;
  const ar=key(s.b.l.a[0]),j=m.findIndex(w=>w&&w!==s&&w.k===s.k&&w.b.o==='*'&&key(w.b.l)===key(w.b.r)&&w.b.l.f==='math.cos'&&key(w.b.l.a[0])===ar);
  if(j>=0){c+=s.k;m[i]=m[j]=null;}}
 m=m.filter(Boolean).filter(q=>!(q.k===0&&safe(q.b)));
 let parts=m.map(q=>({s:q.k<0?-1:1,e:Math.abs(q.k)===1?q.b:mk('*',q.b,{n:Math.abs(q.k)})}));
 if(!parts.length)return{n:c};
 if(parts.every(p=>pure(p.e))){parts.sort((p,q)=>byKey(p.e,q.e));const pi=parts.findIndex(p=>p.s>0);if(pi>0)parts=[parts[pi]].concat(parts.filter((_,i)=>i!==pi));}
 let res=parts[0].s>0?parts[0].e:{u:'-',a:parts[0].e};
 for(let i=1;i<parts.length;i++)res=mk(parts[i].s>0?'+':'-',res,parts[i].e);
 if(c>0)res=mk('+',res,{n:c});else if(c<0)res=mk('-',res,{n:-c});
 return size(res)<=size(x)?res:x;}
function RWmul(x){
 const o={c:1,s:1,f:[]};fm(x,o);const c=o.c*o.s;if(!isFinite(c))return x;let f=o.f;
 if(c===0&&f.every(safe))return{n:0};
 if(f.every(pure))f=f.slice().sort(byKey);
 if(!f.length)return{n:c};
 let res=prodOf(f);
 if(c===-1)res={u:'-',a:res};else if(c!==1)res=mk('*',res,{n:c});
 return size(res)<=size(x)?res:x;}
function canon(x){const{o,l,r}=x;if(isN(l)&&!isN(r))return mk(o,r,l);if(!isN(r)&&pure(l)&&pure(r)&&key(l)>key(r))return mk(o,r,l);return x;}
const shift=t=>{if((t.o==='+'||t.o==='-')&&isN(t.r)){const c=(t.o==='+'?1:-1)*t.r.n;if(c%90===0&&isFinite(c))return{q:((c/90)%4+4)%4,b:t.l};}return null;};
const FN=(n,...a)=>RW({f:'math.'+n,a});
const neg=a=>({u:'-',a});
function RW(x){
 if(x.n!==undefined||x.v!==undefined)return x;
 if(x.u)return RWu(x);if(x.c)return RWc(x);if(x.f)return RWf(x);return RWb(x);}
function RWu(x){const a=x.a;
 if(x.u==='-'){if(a.o==='-'&&(pure(a.l)||pure(a.r)))return mk('-',a.r,a.l);if(a.o==='*'&&isN(a.r))return mk('*',a.l,{n:-a.r.n});return x;}
 const d=decide(a);if(d!==null)return{n:d?0:1};return x;}
function RWc(x){const{c,a,b}=x;
 const d=decide(c);if(d!==null)return d?a:b;
 if(pure(c)&&key(a)===key(b))return a;
 if(c.u==='!')return RW({c:c.a,a:b,b:a});
 if(a.n===1&&b.n===0&&isBool(c))return c;
 if(a.n===0&&b.n===1)return RW({u:'!',a:c});
 if(pure(c)){if(a.c&&key(a.c)===key(c))return RW({c,a:a.a,b});if(b.c&&key(b.c)===key(c))return RW({c,a,b:b.b});}
 if(b.c&&pure(b.c)&&key(b.a)===key(a))return RW({c:mk('||',c,b.c),a,b:b.b});
 if(a.c&&pure(a.c)&&key(a.b)===key(b))return RW({c:mk('&&',c,a.c),a:a.a,b});
 return x;}
function RWb(x){const{o,l,r}=x;
 if(CMP.has(o)){const d=decide(x);return d!==null?{n:+d}:x;}
 if(o==='&&'){if(isN(l)){if(!l.n&&pure(r))return{n:0};if(l.n&&isBool(r))return r;}return x;}
 if(o==='||'){if(isN(l)){if(l.n&&pure(r))return{n:1};if(!l.n&&isBool(r))return r;}return x;}
 if(o==='/'){
  if(isN(r)&&r.n!==0){
   if(LV()>=2){if(l.o==='*'&&isN(l.r)){const v=l.r.n/r.n;if(isFinite(v))return RW(mk('*',l.l,{n:v}));}
    if(l.o==='/'&&isN(l.r)&&l.r.n!==0){const v=l.r.n*r.n;if(isFinite(v)&&v!==0)return RW(mk('/',l.l,{n:v}));}}
   if(r.n===-1)return neg(l);
    {const e=Math.log2(Math.abs(r.n));if(Number.isInteger(e)&&Math.abs(e)<1000)return RW(mk('*',l,{n:1/r.n}));}}
  if(l.n===0&&safe(r))return{n:0};
  return x;}
 if(o==='*'){
  if(LV()>=2){
   if(isN(r)&&l.o==='/'&&isN(l.r)&&l.r.n!==0){const v=r.n/l.r.n;if(isFinite(v))return RW(mk('*',l.l,{n:v}));}
   if(isN(l)&&r.o==='/'&&isN(r.r)&&r.r.n!==0){const v=l.n/r.r.n;if(isFinite(v))return RW(mk('*',r.l,{n:v}));}
   return RWmul(x);}
  return canon(x);}
 if(LV()>=2)return RWadd(x);
 return o==='+'?canon(x):x;}
function RWf(x){
 if(!x.f.startsWith('math.'))return x;
 const n=x.f.slice(5),a=x.a,t=a[0];
 switch(n){
  case'sin':case'cos':case'tan':
   if(t.u==='-'&&n!=='cos')return neg(FN(n,t.a));
   if(n==='cos'){if(t.u==='-')return FN('cos',t.a);if(t.f==='math.abs')return FN('cos',t.a[0]);}
   if(LV()>=2&&n!=='tan'){const s=shift(t);if(s){const S_=FN('sin',s.b),C_=FN('cos',s.b);
     return n==='sin'?[S_,C_,neg(S_),neg(C_)][s.q]:[C_,neg(S_),neg(C_),S_][s.q];}}
   return x;
  case'abs':{
   if(t.f==='math.abs'||t.f==='math.sqrt'||t.f==='math.exp')return t;
   if(t.u==='-')return FN('abs',t.a);
   if(t.o==='*'&&key(t.l)===key(t.r)&&pure(t))return t;
   const r=rng(t);if(r&&r[0]>=0)return t;return x;}
  case'sqrt':if(t.o==='*'&&key(t.l)===key(t.r)&&pure(t))return FN('abs',t.l);return x;
  case'pow':{const e=a[1];
   if(isN(e)){if(e.n===0&&pure(t))return{n:1};if(e.n===1)return t;if(e.n===2&&pure(t))return mk('*',t,t);
    if((e.n===3||e.n===4)&&t.v!==undefined&&LV()>=2)return e.n===3?mk('*',mk('*',t,t),t):mk('*',mk('*',t,t),mk('*',t,t));}
   if(isN(t)&&t.n===1&&pure(e))return{n:1};return x;}
  case'floor':case'ceil':case'trunc':case'round':if(INTF.has(t.f))return t;return x;
  case'min':case'max':{const b=a[1];if(a.length!==2)return x;
   if(pure(t)&&pure(b)&&key(t)===key(b))return t;
   const ra=rng(t),rb=rng(b);
   if(ra&&rb){if(n==='min'){if(ra[1]<=rb[0]&&pure(b))return t;if(rb[1]<=ra[0]&&pure(t))return b;}else{if(ra[0]>=rb[1]&&pure(b))return t;if(rb[0]>=ra[1]&&pure(t))return b;}}
   if(isN(t)&&!isN(b))return FN(n,b,t);
   if(isN(b)&&t.f===x.f&&t.a.length===2){if(isN(t.a[1]))return FN(n,t.a[0],{n:Math[n](b.n,t.a[1].n)});if(isN(t.a[0]))return FN(n,t.a[1],{n:Math[n](b.n,t.a[0].n)});}
   return x;}
  case'clamp':{const lo=a[1],hi=a[2];
   if(a.length===3&&isN(lo)&&isN(hi)&&lo.n<=hi.n){const r=rng(t);if(r&&r[0]>=lo.n&&r[1]<=hi.n)return t;
    if(t.f==='math.clamp'&&key(t.a[1])===key(lo)&&key(t.a[2])===key(hi))return t;}
   return x;}
  case'lerp':{if(a.length!==3)return x;const b=a[1],w=a[2];
   if(isN(w)&&w.n===0&&pure(b))return t;
   if(pure(t)&&pure(w)&&key(t)===key(b))return t;return x;}
 }return x;}
function S(x){return RW(S1(x));}
function S1(x){
 if(x.n!==undefined||x.v!==undefined)return x;
 if(x.u){const a=S(x.a);if(isN(a))return{n:x.u==='-'?-a.n:+!a.n};if(x.u==='-'&&a.u==='-')return a.a;return{u:x.u,a};}
 if(x.c){const c=S(x.c),a=S(x.a),b=S(x.b);return isN(c)?(c.n?a:b):{c,a,b};}
 if(x.f){const a=x.a.map(S),m=x.f.startsWith('math.')&&x.f.slice(5);
  if(m&&(FOLD.has(m)||/^ease_/.test(m))&&a.every(isN)){const r=MM[m](...a.map(q=>q.n));if(isFinite(r))return{n:r};}
  return{f:x.f,a};}
 const l=S(x.l),r=S(x.r),o=x.o;
 if(isN(l)&&isN(r)){const A=l.n,B=r.n;if(!(o==='/'&&B===0)){const v={'+':A+B,'-':A-B,'*':A*B,'/':A/B,'<':+(A<B),'>':+(A>B),'<=':+(A<=B),'>=':+(A>=B),'==':+(A===B),'!=':+(A!==B),'&&':+(A&&B),'||':+(A||B)}[o];if(isFinite(v))return{n:v};}}
 if(o==='+'){if(l.n===0)return r;if(r.n===0)return l;}
 if(o==='-'&&r.n===0)return l;
 if(o==='*'){if(l.n===1)return r;if(r.n===1)return l;}
 if(o==='/'&&r.n===1)return l;
 if((o==='*'||o==='+')&&isN(r)&&l.o===o&&isN(l.r)){const v=o==='*'?l.r.n*r.n:l.r.n+r.n;if(isFinite(v))return S({o,l:l.l,r:{n:v}});}
 return{o,l,r};}
const fixS=e=>{let k=key(e),y=S(e);for(let i=0;i<8;i++){const k2=key(y);if(k2===k)break;k=k2;y=S(y);}return y;};
/* ---- 식 단위 수치 검증(퍼징): 원본 AST와 최적화 AST를 같은 입력·같은 난수열로 평가해 하나라도 다르면 그 식은 원본 유지 ---- */
function evAst(x,E){
 if(x.n!==undefined)return x.n;
 if(x.v!==undefined){if(x.v==='math.pi')return Math.PI;const w=E[x.v];return(w===undefined||w!==w)?0:w;}
 if(x.u){const a=evAst(x.a,E);return x.u==='-'?-a:(a?0:1);}
 if(x.c)return evAst(x.c,E)?evAst(x.a,E):evAst(x.b,E);
 if(x.f){if(!x.f.startsWith('math.'))throw 0;const f=MM[x.f.slice(5)];if(typeof f!=='function')throw 0;return f(...x.a.map(a=>evAst(a,E)));}
 const o=x.o,l=evAst(x.l,E);
 if(o==='&&')return(l&&evAst(x.r,E))?1:0;if(o==='||')return(l||evAst(x.r,E))?1:0;
 const r=evAst(x.r,E);
 switch(o){case'+':return l+r;case'-':return l-r;case'*':return l*r;case'/':return r===0?0:l/r;case'<':return+(l<r);case'>':return+(l>r);case'<=':return+(l<=r);case'>=':return+(l>=r);case'==':return+(l==r);case'!=':return+(l!=r);}
 throw 0;}
function evalP(P,E){let last;for(const s of P.st){last=evAst(s.e,E);if(s.as)E[s.as]=last;if(s.ret)return{v:last};}return{v:last};}
const okv=(a,b)=>a===b||(a!==a&&b!==b)||Math.abs(a-b)<=1e-9*Math.max(1,Math.abs(a),Math.abs(b));
function guard(P0,P1){
 const sv=Math.random;
 try{
  const names=new Set();P0.st.forEach(s=>vars(s.e,names));
  const vn=[...names].filter(n=>/^[vqtc]\./.test(n)),asg=P0.st.filter(s=>s.as).map(s=>s.as);
  const cmpV=P0.st.some(s=>s.ret)||(!P0.semi&&P0.st.length===1);
  let z=2463534242;const rnd=()=>(z=(Math.imul(z,1664525)+1013904223)>>>0)/4294967296;
  const mkR=sd=>{let q=sd>>>0;return()=>(q=(Math.imul(q,1664525)+1013904223)>>>0)/4294967296;};
  for(let it=0;it<192;it++){
   const E0={};vn.forEach(n=>{if(/random/.test(n)){E0[n]=rnd();return;}const u=rnd();
    E0[n]=u<.1?0:u<.2?[1,-1,2,-2,.5,90,180,360][(rnd()*8)|0]:u<.5?(rnd()*2-1)*(rnd()<.5?1:10):u<.65?rnd():u<.8?rnd()*720-360:u<.92?((rnd()*2000-1000)|0):Math.floor(rnd()*200);});
   const E1={...E0},E2={...E0};
   Math.random=mkR(it*7919+13);const r0=evalP(P0,E1);Math.random=mkR(it*7919+13);const r1=evalP(P1,E2);
   if(cmpV&&!okv(r0.v,r1.v))return false;
   for(const k of asg)if(k in E2&&!(E1[k]===undefined&&E2[k]===undefined)&&!okv(E1[k],E2[k]))return false;}
  return true;
 }catch(e){return false;}finally{Math.random=sv;}}
const key=x=>JSON.stringify(x);
const size=x=>x.n!==undefined||x.v!==undefined?1:x.u?1+size(x.a):x.c?1+size(x.c)+size(x.a)+size(x.b):x.f?1+x.a.reduce((s,a)=>s+size(a),0):1+size(x.l)+size(x.r);
function vars(x,s){if(x.v!==undefined)s.add(x.v);else if(x.f){s.add(x.f);x.a.forEach(a=>vars(a,s));}else if(x.u)vars(x.a,s);else if(x.c){vars(x.c,s);vars(x.a,s);vars(x.b,s);}else if(x.o){vars(x.l,s);vars(x.r,s);}return s;}
function kids(x){return x.u?[x.a]:x.c?[x.c,x.a,x.b]:x.f?x.a:x.o?[x.l,x.r]:[];}
function subst(x,k,t){if(key(x)===k)return t;if(x.u)return{u:x.u,a:subst(x.a,k,t)};if(x.c)return{c:subst(x.c,k,t),a:subst(x.a,k,t),b:subst(x.b,k,t)};if(x.f)return{f:x.f,a:x.a.map(a=>subst(a,k,t))};if(x.o)return{o:x.o,l:subst(x.l,k,t),r:subst(x.r,k,t)};return x;}
function cse(P){ // P: {st:[...]}; 같은 문자열 안에서 변하지 않는 반복 부분식을 t.* 임시변수로
 const asg=new Set(P.st.filter(s=>s.as).map(s=>s.as)),defs=[];let nt=0;
 for(let it=0;it<60;it++){
  const cnt=new Map(),roots=P.st.map(s=>s.e).concat(defs.map(d=>d.e));
  (function w(x){if(x.n===undefined&&x.v===undefined&&!(x.u&&kids(x)[0].v!==undefined)){const k=key(x);const c=cnt.get(k);cnt.set(k,c?{x,c:c.c+1}:{x,c:1});}kids(x).forEach(w);}).call(null,{f:'$',a:roots}); 
  let best=null,bs=0;
  cnt.forEach((o,k)=>{if(o.c<2||o.x.f==='$')return;const vs=vars(o.x,new Set());if(!pure(o.x))return;for(const v of vs)if(asg.has(v))return;const g=o.c*size(o.x)-size(o.x)-o.c;if(g>bs){bs=g;best=[k,o.x];}});
  if(!best)break;
  const tn={v:'t.o'+(nt++)},[k,x]=best;
  P.st.forEach(s=>s.e=subst(s.e,k,tn)); defs.forEach(d=>d.e=subst(d.e,k,tn));
  let at=defs.findIndex(d=>vars(d.e,new Set()).has(tn.v));if(at<0)at=defs.length;
  defs.splice(at,0,{as:tn.v,e:x});}
 P.st=defs.concat(P.st);}
const PR={'||':1,'&&':2,'==':3,'!=':3,'<':4,'>':4,'<=':4,'>=':4,'+':5,'-':5,'*':6,'/':6};
const fmt=n=>{let s=String(n);if(/e/.test(s))s=n.toFixed(20).replace(/\.?0+$/,'');return s;};
function pr(x,min){let s,p;
 if(x.n!==undefined){s=fmt(Math.abs(x.n));if(x.n<0||Object.is(x.n,-0)){s='-'+s;p=5.5;}else p=9;}
 else if(x.v!==undefined){s=x.v;p=9;}
 else if(x.u){s=x.u+pr(x.a,8);p=5.5;}
 else if(x.c){s=pr(x.c,1)+'?'+pr(x.a,1)+':'+pr(x.b,1);p=0;}
 else if(x.f){s=x.f+'('+x.a.map(a=>pr(a,0)).join(',')+')';p=9;}
 else{p=PR[x.o];s=pr(x.l,p)+x.o+pr(x.r,p+1);}
 return p<min?'('+s+')':s;}
const emit=P=>{if(!P.semi&&P.st.length>1)P.st[P.st.length-1].ret=1;const body=P.st.map(s=>s.ret?'return '+pr(s.e,0):s.as?s.as+'='+pr(s.e,0):pr(s.e,0));return P.semi||P.st.length>1?body.join(';')+';':body[0];};
const isMol=s=>/[\d(+*\/<>?=;-]|\b(?:v|q|t|variable|query|temp|math)\./i.test(s);
function collect(json){const refs=[],c=json.particle_effect.components||{},ev=json.particle_effect.events||{};
 (function w(o){for(const k in o){if(typeof o[k]==='string'){if(isMol(o[k]))refs.push([o,k]);}else if(o[k]&&typeof o[k]==='object')w(o[k]);}})(c);
 for(const k in ev)if(typeof ev[k].expression==='string')refs.push([ev[k],'expression']);return refs;}
const cntOps=P=>P.st.reduce((a,s)=>a+size(s.e),0);
function optimize(json){
 const j=JSON.parse(JSON.stringify(json)),refs=collect(j),items=[],rawReads=new Set();let before=0,raw0=0,raw1=0;
 refs.forEach(([o,k])=>{const src=o[k];raw0+=src.length;try{if(src.length>12000)throw 0;const P=stmts(src);before+=cntOps(P);items.push({o,k,P,src});}catch(e){(src.match(/\b(?:v|variable|t|temp)\.\w+/gi)||[]).forEach(m=>rawReads.add(m.toLowerCase().replace(/^variable\./,'v.').replace(/^temp\./,'t.')));before+=Math.ceil(src.length/4);raw1+=src.length;}});
 let bad=0,checked=0;items.forEach(it=>{it.P0=cP(it.P);it.P.st.forEach(s=>{s.e=fixS(s.e);});checked++;if(!guard(it.P0,it.P)){it.P=cP(it.P0);it.bad=true;bad++;}else it.P1=cP(it.P);});
 for(let r=0;r<6;r++){const reads=new Set(rawReads);items.forEach(it=>it.P.st.forEach(s=>vars(s.e,reads)));let ch=false;
  items.forEach(it=>{const n=it.P.st.length;const keep=it.P.st.filter(s=>!(s.as&&s.as.startsWith('v.')&&!reads.has(s.as)));if(keep.length&&keep.length<n){it.P.st=keep;ch=true;}});if(!ch)break;}
 let after=0;items.forEach(it=>{if(!it.bad){it.P.st.forEach(s=>{s.e=S(s.e);});cse(it.P);if(!guard(it.P0,it.P)){it.P=cP(it.P1);bad++;}}after+=cntOps(it.P);it.o[it.k]=emit(it.P);});
 let raw2=0;items.forEach(it=>raw2+=it.o[it.k].length);
 return {json:j,before,after:after+Math.ceil(raw1/4),chars0:raw0,chars1:raw2+raw1,bad,checked};}
function sample(json){const sv=Math.random;let z=12345;Math.random=()=>(z=(z*1664525+1013904223)>>>0)/4294967296;try{const S0=OreSim.build(json),o=[];[0,0.2,0.6,1.3,S0.killAt<50?S0.killAt+0.1:2.5].forEach(t=>o.push(OreSim.evalAt(S0,t).map(p=>[p.alive,p.pos,p.size,p.col])));return o;}finally{Math.random=sv;}}
function estCost(json){globalThis.__oreLegacyEval=true;try{const S0=OreSim.build(json),n=Math.max(1,S0.steady?S0.steady.max:S0.ps.length);S0.stride=n;const t0=performance.now();OreSim.evalAt(S0,0.5);return (performance.now()-t0)*n*14;}catch(e){return 0;}finally{globalThis.__oreLegacyEval=false;}}
function timeIt(json){const S0=OreSim.build(json),t0=performance.now();for(let i=0;i<4;i++)OreSim.evalAt(S0,0.5+i*0.2);return (performance.now()-t0)/4;}
function verify(a,b){const A=sample(a),B=sample(b);let mx=0;for(let t=0;t<A.length;t++){if(A[t].length!==B[t].length)return 9;for(let i=0;i<A[t].length;i++){if(A[t][i][0]!==B[t][i][0])return 9;for(let g=1;g<4;g++)(A[t][i][g]||[]).forEach((v,q)=>{const w=B[t][i][g][q];mx=Math.max(mx,Math.abs(v-w)/Math.max(1,Math.abs(v)));});}}return mx;}
OPT.toJS=function(src){const P=stmts(src);
 const nm=v=>{if(v==='math.pi')return 'M.pi';const m=/^([vqtc])\.(\w+)$/.exec(v);if(!m)throw 0;return 'N('+({v:'V',q:'Q',t:'T',c:'Q'})[m[1]]+'.'+m[2]+')';};
 const J=x=>x.n!==undefined?(x.n<0?'('+x.n+')':String(x.n)):x.v!==undefined?nm(x.v):x.u?(x.u==='-'?'(-'+J(x.a)+')':'(('+J(x.a)+')?0:1)'):x.c?'(('+J(x.c)+')?'+J(x.a)+':'+J(x.b)+')':x.f?(()=>{if(!x.f.startsWith('math.'))throw 0;const n=x.f.slice(5);if(!(n in MM))throw new Error('알 수 없는 math.'+n);return 'M.'+n+'('+x.a.map(J).join(',')+')';})():x.o==='/'?'D('+J(x.l)+','+J(x.r)+')':x.o==='&&'?'((('+J(x.l)+')&&('+J(x.r)+'))?1:0)':x.o==='||'?'((('+J(x.l)+')||('+J(x.r)+'))?1:0)':'('+J(x.l)+x.o+J(x.r)+')';
 if(!P.st.length)return 'return 0;';
 if(!P.semi&&P.st.length===1&&!P.st[0].as)return 'return '+J(P.st[0].e)+';';
 return P.st.map(s=>s.ret?'return '+J(s.e):s.as?s.as.replace(/^(\w)\./,(a,b)=>b.toUpperCase()+'.')+'='+J(s.e):J(s.e)).join(';')+';';};
// [v10.3] 지역 변수 버전: 같은 식을 같은 순서로 계산하되 V/T 접근을 지역 변수로 바꾼다.
OPT.toJSFast=function(src){const P=stmts(src);
 const loc=new Map(), asg=new Set();
 const L=(full)=>{ if(!loc.has(full)) loc.set(full,'L'+loc.size); return loc.get(full); };
 const nm=v=>{if(v==='math.pi')return 'M.pi';const m=/^([vqtc])\.(\w+)$/.exec(v);if(!m)throw 0;if(m[1]==='q'||m[1]==='c')return 'N(Q.'+m[2]+')';return 'N('+L(m[1]+'.'+m[2])+')';};
 const J=x=>x.n!==undefined?(x.n<0?'('+x.n+')':String(x.n)):x.v!==undefined?nm(x.v):x.u?(x.u==='-'?'(-'+J(x.a)+')':'(('+J(x.a)+')?0:1)'):x.c?'(('+J(x.c)+')?'+J(x.a)+':'+J(x.b)+')':x.f?(()=>{if(!x.f.startsWith('math.'))throw 0;const n=x.f.slice(5);if(!(n in MM))throw new Error('알 수 없는 math.'+n);return 'M.'+n+'('+x.a.map(J).join(',')+')';})():x.o==='/'?'D('+J(x.l)+','+J(x.r)+')':x.o==='&&'?'((('+J(x.l)+')&&('+J(x.r)+'))?1:0)':x.o==='||'?'((('+J(x.l)+')||('+J(x.r)+'))?1:0)':'('+J(x.l)+x.o+J(x.r)+')';
 if(!P.st.length)return 'return 0;';
 const obj=k=>(k[0]==='v'?'V':'T')+'.'+k.slice(2);
 const declOf=()=>loc.size?'let '+[...loc].map(([k,l])=>l+'='+obj(k)).join(',')+';':'';
 if(!P.semi&&P.st.length===1&&!P.st[0].as){ const e=J(P.st[0].e); return declOf()+'return '+e+';'; }
 const body=P.st.map(s=>{
   if(s.ret) return {r:J(s.e)};
   if(s.as){ const m=/^([vt])\.(\w+)$/.exec(s.as); if(!m) throw 0; const k=m[1]+'.'+m[2]; asg.add(k); return {c:L(k)+'='+J(s.e)}; }
   return {c:J(s.e)};
 });
 const decl=declOf();
 const wb=[...asg].map(k=>obj(k)+'='+loc.get(k)+';').join('');
 let out=decl;
 for(const b of body){ if(b.r!==undefined){ out+='{const __r='+b.r+';'+wb+'return __r;}'; return out; } out+=b.c+';'; }
 return out+wb;};
OPT.optimize=optimize;OPT.verify=verify;
const _g0=generateAllParticleJSONs;
// [연산 과다 수정] 식 하나가 약 60KB를 넘으면 JS 엔진이 최적화를 포기해 프레임당 시간이 10배 넘게 늘고(측정: 55KB 46ms → 65KB 486ms)
// 3D 뷰가 멈춘다. 가장 긴 식이 55KB를 넘으면 Accumulate 분할 상한을 줄여가며 다시 컴파일한다.
const EXPR_SOFT_MAX = 55000;
function maxExprLen(r){ let m=0; const w=o=>{ if(typeof o==='string'){ if(o.length>m) m=o.length; } else if(o&&typeof o==='object') for(const k in o) w(o[k]); }; if(r&&r.results) r.results.forEach(x=>w(x.json)); return m; }
const _g=function(id){ return withWireIndex(()=>_gInner(id)); };
const _gInner=function(id){
  // [v10] 상한(55KB)에 맞는 가장 큰 분할 수를 이분 탐색으로 찾는다(이전: 32→19→11→6처럼 크게 깎아 필요 이상으로 줄였음).
  ACC_BUDGET=32; let r=_g0(id);
  if(maxExprLen(r)<=EXPR_SOFT_MAX) return r;
  let lo=1, hi=31, best=null;
  while(lo<=hi){ const mid=(lo+hi)>>1; ACC_BUDGET=mid; const rr=_g0(id);
    if(maxExprLen(rr)<=EXPR_SOFT_MAX || mid===1){ best=rr; lo=mid+1; } else hi=mid-1; }
  ACC_BUDGET=32;
  return best||r;
};
generateAllParticleJSONs=function(id){const r=_g(id);if(!OPT.on||!r||!r.results)return r;
 r.results.forEach(x=>{try{const sz=JSON.stringify(x.json).length,est=estCost(x.json);
   if(sz>40000||est>OPT.maxEstMs){x.optStats={msg:`최적화 건너뜀: 식이 매우 큽니다(${Math.round(sz/1000)}KB${est>1000?', 검증 예상 '+(est/1000).toFixed(0)+'초':''}). 기기가 멈추지 않도록 원본을 그대로 씁니다 — 무거우면 Accumulate samples를 줄여 보세요(식이 길어도 프리뷰는 정상 동작합니다).`};return;}
   const o=optimize(x.json),err=verify(x.json,o.json);
  if(err>1e-5){x.optStats={msg:'최적화 결과가 원본과 달라(오차 '+err.toExponential(1)+') 원본을 유지했습니다.'};return;}
  const t0=timeIt(x.json),t1=timeIt(o.json);x.orig=x.json;x.json=o.json;
  x.optStats={msg:`연산 노드 ${o.before}→${o.after} (${Math.round((1-o.after/Math.max(1,o.before))*100)}% 감소) · 글자수 ${o.chars0}→${o.chars1} · 평가시간 ${t0.toFixed(1)}→${t1.toFixed(1)}ms · 최대오차 ${err.toExponential(1)} · 식검증 ${o.checked-o.bad}/${o.checked}${o.bad?' (원본유지 '+o.bad+')':''}`};
 }catch(e){x.optStats={msg:'최적화 건너뜀: '+e.message};}});return r;};
})();
/* =========================================================================
   Headless API — entry points for the MCP server and tests (no effect on the browser)
   This file (ore-core.js) holds only the calculation logic that runs without a screen (DOM):
   formula parser → node definitions → graph compiler (Molang) → JSON → simulation/checks → Molang optimizer.
   It is extracted from html/ore_vfx_editor.html by `npm run sync`; this footer is kept from the previous core.
   ========================================================================= */
// Plugs one graph ({nodes, wires, nextId, pack}) into state, runs fn, then restores state.
// Nodes created inside fn (createNode…) advance graph.nextId.
function oreWithGraph(graph, fn){
  const sv = { nodes:state.nodes, wires:state.wires, nextId:state.nextId, pack:state.pack, uv:globalThis.__oreUserVarVals };
  graph.nodes = graph.nodes || {}; graph.wires = graph.wires || {};
  state.nodes = graph.nodes; state.wires = graph.wires; state.nextId = graph.nextId || 1;
  state.pack = graph.pack || { name:'', desc:'', icon:'' };
  try{ return fn(); }
  finally{
    graph.nextId = state.nextId;
    state.nodes = sv.nodes; state.wires = sv.wires; state.nextId = sv.nextId; state.pack = sv.pack; globalThis.__oreUserVarVals = sv.uv;
  }
}
globalThis.OreCore = {
  version: '1.1.5',
  // Display text translation: oreT(Korean text) → English (unless ORE_LANG is 'ko'). The MCP server uses it for messages.
  translate: (s) => oreT(s),
  state, NODE_DEFS, SHAPE_PRESETS, DETAIL_INPUTS, WALL_DK, CONST_RESERVED,
  substParams, compileFormula, uid, createNode, createWire, wallEnsure,
  nodeAllInputs, detailKeysOf, findWireInto, constVarName, normParticleId, safeIdTag,
  validateNoCycles, findOutputForEmitter,
  withGraph: oreWithGraph,
  withWireIndex,
  // Calls the current export function, including the optimizer (OreOpt.on) — the same path as the web editor's Export.
  compile: (baseIdentifier)=>generateAllParticleJSONs(baseIdentifier),
  // Clears the short-name table for internal variables; call before compiling so a graph always gets the same names.
  resetNaming: ()=>{ _ctxShortMap = new Map(); },
  // Image node helpers (pure math) — getting the image pixels is up to the caller
  binarizeSample, traceAllContours, resampleClosedPolyline, ellipticFourierDescriptors, fitFourier2D,
  sim: OreSimCore,
};
