---
name: snowflake-architecture-diagram-connected-cli
description: "Connected-CLI mode: invoke deployed SNOWGRAM_AGENT via cortex agents run, parse Mermaid from response, render in local viewer. No live frontend required."
parent_skill: snowflake-architecture-diagram
---

# Connected-CLI mode

Calls the deployed SnowGram agent directly via the Cortex Agents API and renders the response in the bundled lightweight viewer. No Next.js frontend needed.

## Prerequisites

- Active `cortex` connection (set via `cortex connections set <name>`)
- Agent `SNOWGRAM_DB.AGENTS.SNOWGRAM_AGENT` deployed and reachable from the active role
- Function grants verified during the parent skill's mode-detection probe

## Workflow

### Step 1: Invoke the agent

```bash
cortex agents run SNOWGRAM_DB.AGENTS.SNOWGRAM_AGENT "<user's prompt>"
```

Capture stdout. The agent typically returns:

1. A short overview paragraph
2. A Mermaid code block (delimited by ` ```mermaid ` / ` ``` `)
3. Optionally a JSON block with components / connections (also fenced)
4. Best-practice bullets and citations

### Step 2: Extract Mermaid

Use a regex to extract the first fenced Mermaid block:

```python
import re
m = re.search(r'```mermaid\s*\n(.*?)\n```', agent_output, re.DOTALL)
mermaid = m.group(1) if m else None
```

**If Mermaid is present**: continue to Step 3.

**If Mermaid is missing** (agent answered in prose only):
- The agent's tool description may not be enforcing Mermaid output (see `snowgram-agent` skill for the fix)
- Fall through to standalone mode using the agent's textual response as a hint:
  - Pass the agent's response to a freeform composer call: extract any component names mentioned, look them up in `<DIR>/assets/component_synonyms.json`, and feed BLOCK_IDs to `composer.py`
  - Tag the result `source: "connected-cli:fallback-to-standalone"`

**⚠️ STOP**: confirm the extracted Mermaid (or the fallback's component selection) with the user before launching the viewer.

### Step 3: Optional — semantic-view enrichment

If user terms in the prompt didn't appear in the agent's response components, query the deployed semantic view for synonym resolution:

```bash
cortex semantic-views query SNOWGRAM_DB.CORE.COMPONENT_MAP_SV "what component type is '<user_term>'"
```

Add resolved component types as tags in the diagram metadata (visible in the viewer's source footer).

### Step 4: Documentation citations

```bash
cortex search docs "<topic from user's prompt>"
```

Collect 3-5 citations.

### Step 5: Write state.json + launch viewer

```bash
cat > <DIR>/assets/viewer/state.json <<EOF
{
  "mermaid": "<Mermaid extracted or composed>",
  "title": "<short title from user prompt>",
  "source": "connected-cli:agent" or "connected-cli:fallback-to-standalone",
  "citations": [...]
}
EOF

<DIR>/assets/scripts/launch_viewer.sh
```

### Step 6: Iteration

Each follow-up prompt is a fresh `cortex agents run` call. The deployed agent does not maintain conversational state across separate `cortex agents run` invocations (no thread_id is plumbed through this CLI path).

For threaded refinement, escape to `connected-ui` mode where the live frontend handles per-tab thread state.

## Tools

| Tool | Used for |
|---|---|
| `cortex agents run SNOWGRAM_DB.AGENTS.SNOWGRAM_AGENT "<q>"` | Primary agent invocation |
| `cortex semantic-views query COMPONENT_MAP_SV "<q>"` | Synonym enrichment |
| `cortex search docs "<q>"` | Citations |
| `python3 <DIR>/assets/composer/composer.py` | Fallback when agent omits Mermaid |
| `<DIR>/assets/scripts/launch_viewer.sh` | Render |

## Stopping points

- ✋ After Step 2: confirm extracted Mermaid (or fallback decision)
- ✋ After Step 5: viewer launched, user reviews
- ✋ Before iteration: confirm continued refinement vs escape to connected-ui

## Output

- Diagram in viewer at `http://localhost:<port>/`
- Downloadable `.mmd`, `.svg`, `.png`
- Citations drawer
- Source tag indicates `connected-cli:agent` or `connected-cli:fallback-to-standalone`

## Failure modes

| Symptom | Likely cause | Action |
|---|---|---|
| `cortex agents run` errors with "agent not found" | Wrong DB / role / agent not deployed | Route to `bootstrap` mode |
| Empty response | Agent timeout or quota | Retry once; on second failure, fall back to standalone |
| Mermaid syntax invalid in viewer | Agent emitted stale flowchart syntax | Run `cortex sql -q "SELECT VALIDATE_MERMAID_SYNTAX('<mermaid>')"` if connected; otherwise edit the .mmd download manually |
| Mermaid missing from response | Agent tool description not enforcing output | Fall through to standalone composer; flag for `snowgram-agent` skill |
