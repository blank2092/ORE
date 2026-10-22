# ORE MCP 서버

[English](README.md)

AI 앱(Claude Desktop, Claude Code 등 MCP 클라이언트)이 ORE 노드 그래프를 만들고 고칠 수 있게 하는 MCP 서버입니다.
그래프는 웹 에디터(`../html/ore_vfx_editor.html`)와 **같은 컴파일러**로 Bedrock 파티클 JSON과 `.mcpack` 리소스팩이 됩니다.
내 컴퓨터에서 실행됩니다(stdio).

- AI는 Molang이나 출력 JSON을 직접 쓰지 않습니다. 항상 그래프를 고치고, 그래프가 컴파일됩니다.
- 그래프는 웹 에디터의 💾 형식으로 저장되어, 웹 에디터의 📂로 열어 눈으로 확인하고 손으로 이어서 고칠 수 있습니다.
- 서버의 메시지는 영어입니다. AI에게는 한국어로 요청해도 됩니다.

## 1. 받기

- GitHub 저장소 페이지에서 **Code → Download ZIP**을 누르거나, **Releases**에서 소스 ZIP을 받습니다.
- 압축을 풀고 안의 `mcp_tool` 폴더를 씁니다. 띄어쓰기·한글이 없는 짧은 경로가 편합니다(예: `C:\ORE`).

## 2. Node.js 확인

Node.js **20.3 이상**이 필요합니다. 명령 프롬프트(macOS는 터미널)에서 확인합니다.

```
node -v
npm -v
```

`node -v`가 `v20.3.0`보다 낮거나 명령을 찾을 수 없다면 [nodejs.org](https://nodejs.org/)에서 LTS 버전을 설치하세요.

## 3. 설치

```
cd mcp_tool
npm install
```

선택: `npm run check`를 실행하면 서버를 띄워 도구를 한 번씩 호출해 보고, 잘 동작하는지 알려 줍니다.

AI가 파일을 읽고 쓸 **작업 폴더**를 하나 만들어 두세요(예: `C:\Users\me\ore-work`). 서버는 이 폴더 밖의 파일은 읽고 쓰지 않습니다.

## 4. AI 앱에 연결

### Claude Desktop

1. Claude Desktop을 완전히 종료합니다(Windows: 트레이 아이콘 마우스 오른쪽 → 종료).
2. 설정 파일을 엽니다.
   - Windows: `%APPDATA%\Claude\claude_desktop_config.json`
   - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
3. 맨 바깥 `{ }` 안에 `"mcpServers"`를 추가합니다. 이미 다른 설정이 있으면 앞 항목 뒤에 쉼표를 붙이고 이어서 씁니다.
   경로는 **절대 경로**로 쓰고, Windows에서는 `\`를 모두 `\\`로 씁니다.

Windows:

```json
{
  "mcpServers": {
    "ore": {
      "command": "node",
      "args": ["C:\\ORE\\mcp_tool\\src\\server.mjs"],
      "env": { "ORE_WORKDIR": "C:\\Users\\me\\ore-work" }
    }
  }
}
```

macOS:

```json
{
  "mcpServers": {
    "ore": {
      "command": "node",
      "args": ["/Users/me/ORE/mcp_tool/src/server.mjs"],
      "env": { "ORE_WORKDIR": "/Users/me/ore-work" }
    }
  }
}
```

4. Claude Desktop을 다시 실행하고, 입력창 왼쪽 아래 **＋ → Connectors**에서 `ore`가 있는지 확인합니다.

### Claude Code

```
claude mcp add --scope user --env ORE_WORKDIR=C:\Users\me\ore-work --transport stdio ore -- node "C:\ORE\mcp_tool\src\server.mjs"
```

`claude mcp list`로 확인합니다. (`--scope user`를 넣으면 어느 폴더에서든 쓸 수 있습니다.)

### 설정 (환경변수)

| 이름 | 하는 일 |
|---|---|
| `ORE_WORKDIR` | 파일을 읽고 쓸 작업 폴더(권장). 비우면 서버를 실행한 폴더 |
| `ORE_ALLOW_RAW_MOLANG` | `1`이면 Particle Event의 `expr`(검사 없이 JSON에 들어가는 Molang) 입력을 허용. 기본은 막힘 |

## 5. 첫 실행 확인

채팅에서 이렇게 요청해 보세요.

> ore로 test라는 새 그래프를 만들고, 열린 그래프 목록을 보여 준 다음 검사해줘

`ore_new_graph` → `ore_list_graphs` → `ore_validate`가 차례로 실행되고 **"Check passed"**가 나오면 정상입니다.
이어서 "test를 saves/test.txt로 저장해줘"라고 하면 작업 폴더에 파일이 생기고, 웹 에디터의 📂로 열 수 있습니다.

## 문제 해결

| 증상 | 확인할 것 |
|---|---|
| Connectors에 `ore`가 없음 | 설정 파일 문법(쉼표·따옴표·`\\`), 앱을 완전히 종료한 뒤 고쳤는지 |
| `ore`는 있는데 오류 표시 | 로그 파일: Windows `%APPDATA%\Claude\logs\mcp-server-ore.log`, macOS `~/Library/Logs/Claude/mcp-server-ore.log` |
| 로그에 `node`를 찾을 수 없음 | `"command"`에 Node 전체 경로 (예: `"C:\\Program Files\\nodejs\\node.exe"`, macOS는 터미널에서 `which node`로 확인) |
| 로그에 `Cannot find module` | `mcp_tool` 폴더에서 `npm install`을 했는지, `args`가 `mcp_tool/src/server.mjs`를 가리키는지 |
| "Paths outside the work folder are not allowed" | `ORE_WORKDIR` 폴더가 실제로 있는지, AI에게 그 폴더 기준 상대 경로(예: `saves/fire.txt`)를 쓰게 했는지 |

서버만 따로 시험하려면 `mcp_tool` 폴더에서 `npm start`를 실행합니다. 오류 없이
`ore-vfx-mcp-server running (stdio)`가 나오면 서버 자체는 정상입니다(Ctrl+C로 종료).

## 이렇게 요청하세요

원하는 것을 말로 설명하면 됩니다.

- "ore로 위로 솟구쳤다가 퍼지는 불꽃 이펙트 만들어줘"
- "파티클이 중심으로 빨려 들어가는 소용돌이 만들고 시뮬레이션으로 확인해줘"
- "saves/fire.txt 열어서 파티클 수를 300개로 늘리고 색을 초록 계열로 바꿔줘"
- "fire를 out/fire.mcpack으로 만들어줘"

## 도구 (21개)

| 분류 | 도구 |
|---|---|
| 안내 | `ore_help` (basics · formula · physics · events · limits) · `ore_list_node_types` |
| 그래프 | `ore_new_graph` · `ore_open_graph` · `ore_list_graphs` · `ore_get_graph` · `ore_get_node` · `ore_close_graph` |
| 편집 | `ore_add_node` · `ore_set_params` · `ore_connect` · `ore_disconnect` · `ore_remove_node` · `ore_set_texture` · `ore_auto_layout` |
| 확인 | `ore_validate` · `ore_simulate` · `ore_preview_json` (읽기 전용) |
| 출력 | `ore_save_graph` (웹 에디터 형식) · `ore_export_json` · `ore_build_mcpack` |

편집 도구가 막는 것: 없는 칸 이름, 선택지 밖의 값, 타입이 틀린 값, 문법이 틀린 수식, 없는 소켓, 순환 연결,
Emitter 두 개, 이미지 베이크 데이터 직접 입력. 한 번의 호출에 잘못된 값이 하나라도 있으면 아무것도 바뀌지 않습니다.

**제한**

- 이미지가 필요한 노드(Shape (Image Contour), Vector Field (Image))는 MCP에서 이미지를 처리하지 못합니다.
  웹 에디터에서 이미지를 넣어 저장한 파일을 열면 MCP에서도 그대로 컴파일됩니다.
- `ore_simulate`는 메인 이미터 파일 하나만 시뮬레이션합니다(웹 에디터의 ALL 재생처럼 서브 이미터까지 합쳐 보지는 않음).

## 폴더

| 경로 | 내용 |
|---|---|
| `src/server.mjs` | MCP 서버 — 도구 정의 |
| `src/store.mjs` | 열린 그래프 보관과 편집 규칙(검사) |
| `src/ore-headless.mjs` | core를 화면 없이 Node에서 실행하는 로더 |
| `core/ore-core.js` | **자동 생성.** 웹 에디터 HTML에서 뽑은 계산 부분. 직접 고치지 마세요 |
| `core/node-descriptions.json` | **자동 생성.** 웹 에디터 팔레트의 노드 설명(영어) |
| `tools/sync-core.mjs` | HTML → core 추출 도구 |
| `tools/i18n-missing.mjs` | HTML에서 아직 영어 번역이 없는 한국어 문구 목록 |
| `tests/` | 웹 에디터와 결과 비교, 번역 점검, 서버 점검 |

## 개발

```
npm run sync              # ../html/ore_vfx_editor.html → core/ 다시 만들기
npm run sync -- --dry     # 파일은 바꾸지 않고 무엇이 어디로 가는지만 보기
npm run i18n:missing      # HTML에서 영어 번역이 없는 한국어 문구
npm test                  # 아래 전부
npm run smoke             # 테스트 그래프를 헤드리스로 전부 추출해 보기
```

`npm test`가 하는 일:

1. `core/`가 지금 HTML과 맞는지 확인합니다(HTML만 고치고 `npm run sync`를 잊으면 실패).
2. 실제 웹 에디터를 jsdom에서 실행한 추출 결과와 헤드리스 core의 결과를 비교합니다(그래프 31개 × 최적화 끔/켬).
3. 번역 점검: HTML에 번역 없는 문구가 없는지, 컴파일러 메시지가 영어로 다 바뀌는지, 영어 화면에 한국어가 남지 않는지,
   언어를 바꿔도 열린 탭이 남는지.
4. MCP 서버를 띄워 도구를 호출하고, 저장한 파일을 웹 에디터의 불러오기로 다시 열어 봅니다.

`sync`가 나누는 규칙: core에 있던 함수는 core로, 화면 쪽 함수(`tools/ui-names.json`)는 제외합니다.
새 함수는 `document`/`window`를 쓰면 화면 쪽, 아니면 바로 앞 코드와 같은 쪽으로 갑니다. 결과에 "New top-level names"
목록이 나오니 위치가 맞는지 확인하세요. core에 화면 코드가 섞이면 오류로 멈춥니다.

MCP에서는 같은 그래프가 항상 같은 파일로 나오도록, 최적화의 "검증 예상 3초" 규칙(실제 실행 시간을 잼)을 끄고
크기 기준(40KB)만 씁니다. 웹 에디터의 동작은 바뀌지 않습니다.
