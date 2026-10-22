# ORE — Bedrock VFX Node Editor

[English](README.md)

마인크래프트 **베드락 에디션** 파티클을 노드 그래프로 만드는 웹 에디터입니다.
Unity VFX Graph처럼 노드를 연결하면 Bedrock 파티클 JSON(Molang)과 리소스팩(`.mcpack`)을 만들어 줍니다.
Claude 같은 AI 앱이 같은 그래프를 만들고 고칠 수 있는 **MCP 서버**도 함께 들어 있습니다.

에디터는 **영어와 한국어**를 지원합니다(`EN · 한국어` 버튼으로 전환).

## 저장소 구성

```
├── index.html                첫 화면 — 웹 에디터 열기 / MCP 설치 안내
├── html/
│   └── ore_vfx_editor.html   웹 에디터 (파일 하나, 설치 없이 브라우저에서 열기)
├── mcp_tool/                 MCP 서버 — AI가 노드 그래프를 편집·검사·추출
├── LICENSE
└── README.md
```

## 웹 에디터 사용

- **웹 주소로 열기**: 이 저장소의 GitHub Pages 주소(`https://아이디.github.io/저장소이름/`)로 접속해 **웹 에디터 열기**를 누릅니다.
- **파일로 열기**: `html/ore_vfx_editor.html`을 내려받아 브라우저(Chrome, Edge 등)로 엽니다. 서버나 설치가 필요 없습니다.

처음 시작하기:

1. 기본 구성은 **Emitter → Shape → Output**입니다. Emitter의 `j · n · h · seed`를 Shape에, Shape의 `x · y · z`를 Output의 `offset`에 연결합니다.
   (에디터를 열면 예제 그래프가 들어 있어 바로 살펴볼 수 있습니다.)
2. 왼쪽 **Node Library**에서 노드를 추가하거나, 그래프를 우클릭합니다. 소켓을 드래그해 다른 노드에 연결합니다.
3. **▶ 프리뷰**로 3D 미리보기, **추출 →**로 파티클 JSON, **📦 .mcpack**으로 리소스팩을 만듭니다.
4. 💾로 작업 내용을 `.txt` 파일로 저장하고 📂로 다시 엽니다.

주요 노드: Emitter / Sub Emitter / Event, Shape(프리셋·수식·이미지 외곽선), Noise 3D, Curl Noise, Turbulence,
Vortex · Attractor · Directional · Wind Zone · Buoyancy 힘, Wall 충돌, Accumulate(적분), Formula, Color Gradient,
Curve, Flipbook UV, Threshold 등. **ⓘ 설명**을 켜면 노드마다 설명을 볼 수 있습니다.

**언어:** 에디터는 영어로 시작합니다. `EN · 한국어` 버튼(오른쪽 위, 휴대폰에서는 노드 / 3D 프리뷰 탭 옆)으로 바꾸면
열린 탭은 그대로 유지되고, 고른 언어는 기억됩니다. 언어를 바꿔도 추출되는 JSON은 바뀌지 않습니다.

## MCP 서버 (AI로 그래프 편집)

`mcp_tool/`은 Claude Desktop·Claude Code 같은 MCP 클라이언트에 연결하는 로컬 서버입니다.
AI가 노드를 추가·연결하고, 웹 에디터와 **같은 컴파일러**로 검사·시뮬레이션·추출합니다.
AI가 Molang을 직접 쓰지 않고 항상 그래프에서 만들어지며, 결과 그래프는 웹 에디터에서 그대로 열립니다.

설치와 연결 방법: [mcp_tool/README.ko.md](mcp_tool/README.ko.md)

## GitHub Pages 켜기 (저장소 관리자)

1. 저장소의 **Settings → Pages**를 엽니다.
2. **Source**: Deploy from a branch · **Branch**: `main` · **Folder**: `/ (root)` → **Save**
3. 잠시 뒤 같은 화면에 나오는 주소로 접속해 첫 화면과 웹 에디터가 열리는지 확인합니다.

저장소 루트의 `.nojekyll` 파일은 Pages가 파일을 가공하지 않고 그대로 올리게 합니다(지우지 마세요).

## 개발 흐름

웹 에디터 코드는 `html/ore_vfx_editor.html` **한 곳**에만 있습니다. MCP 서버는 이 파일에서 계산 부분을 자동으로 뽑아 씁니다.

1. `html/ore_vfx_editor.html`을 고칩니다(버전은 `<title>`의 `Release x.y.z`).
2. MCP 쪽을 갱신하고 점검합니다.
   ```
   cd mcp_tool
   npm install        # 처음 한 번
   npm run sync       # html → mcp_tool/core/ore-core.js
   npm test           # 웹 에디터와 MCP의 추출 결과가 같은지, 번역이 빠짐없는지, 서버가 동작하는지
   ```
3. HTML과 `mcp_tool/core/`를 함께 커밋합니다. `npm run sync`를 잊으면 GitHub Actions의 테스트가 실패해서 알려 줍니다.

### 새 문구 번역하기

에디터의 글은 코드 안에 한국어로 쓰여 있고, 영어는 스크립트 위쪽의 번역표 `ORE_I18N_EN`(`"한국어": "English"`)에서 나옵니다.
한국어 문구를 새로 넣었다면:

```
cd mcp_tool
npm run i18n:missing             # 영어 번역이 없는 한국어 문구 목록
npm run i18n:missing -- --json   # 같은 목록을 ORE_I18N_EN에 붙여 넣을 수 있는 형태로
```

`{0}`, `{1}` 같은 자리표시자는 영어 문장에도 그대로 넣으세요. 번역이 없는 문구도 동작은 하며, 영어 화면에서 한국어로 보일 뿐입니다.

## 라이선스

[MIT](LICENSE) © 2026 ORE contributors
