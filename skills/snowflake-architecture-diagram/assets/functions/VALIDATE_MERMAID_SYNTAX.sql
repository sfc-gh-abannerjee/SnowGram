CREATE OR REPLACE FUNCTION SNOWGRAM_DB.CORE.VALIDATE_MERMAID_SYNTAX("MERMAID_CODE" VARCHAR)
RETURNS VARCHAR
LANGUAGE PYTHON
RUNTIME_VERSION = '3.11'
HANDLER = 'validate_syntax'
COMMENT='Validates Mermaid diagram syntax and returns detailed error messages.\n\n**RETURNS:** \"VALID\" if correct, otherwise detailed error message(s)'
AS '
import re

def validate_syntax(mermaid_code):
    errors = []
    
    if not mermaid_code or len(mermaid_code.strip()) == 0:
        return "ERROR: Empty or null input - no Mermaid code provided"
    
    code = mermaid_code.strip()
    
    valid_declarations = (''flowchart'', ''graph'', ''sequenceDiagram'', ''classDiagram'', ''erDiagram'', ''gantt'', ''pie'', ''gitGraph'')
    if not any(code.startswith(decl) for decl in valid_declarations):
        first_word = code.split()[0] if code.split() else ''nothing''
        errors.append(f"ERROR: Invalid declaration ''{first_word}''. Must start with one of: {'', ''.join(valid_declarations)}")
    
    has_connection = any(arrow in code for arrow in [''-->'', ''---'', ''-.->'', ''==>'', ''-.->''])
    has_node = ''['' in code or ''(('' in code
    if not has_connection and not has_node:
        errors.append("ERROR: No nodes or connections found")
    
    bracket_pairs = [(''['', '']'', ''square brackets''), (''('', '')'', ''parentheses''), (''{'', ''}'', ''curly braces'')]
    for open_b, close_b, name in bracket_pairs:
        open_count = code.count(open_b)
        close_count = code.count(close_b)
        if open_count != close_count:
            diff = abs(open_count - close_count)
            more = "opening" if open_count > close_count else "closing"
            errors.append(f"ERROR: Unbalanced {name} - {diff} extra {more}. Found {open_count} ''{open_b}'' vs {close_count} ''{close_b}''")
    
    if code.startswith((''flowchart'', ''graph'')):
        defined = set(re.findall(r''([A-Za-z_]\\w*)\\s*[\\[\\(\\{]'', code))
        edges = re.findall(r''([A-Za-z_]\\w*)\\s*(?:-->|---|-\\.?->|==>)\\s*(?:\\|[^|]*\\|)?\\s*([A-Za-z_]\\w*)'', code)
        referenced = set()
        for src, tgt in edges:
            referenced.add(src)
            referenced.add(tgt)
        
        keywords = {''flowchart'', ''graph'', ''TD'', ''TB'', ''LR'', ''RL'', ''BT'', ''subgraph'', ''end'', ''style'', ''class'', ''click''}
        orphans = (referenced - defined) - keywords
        if orphans:
            errors.append(f"WARNING: Undefined nodes: {'', ''.join(sorted(orphans))}. Add definitions like: {list(orphans)[0]}[Label]")
    
    if re.search(r''\\[\\s*\\]'', code):
        errors.append("WARNING: Empty node label detected (e.g., ''A[]'')")
    
    if ''-> >'' in code or ''- >'' in code:
        errors.append("ERROR: Malformed arrow. Use ''-->'' without spaces")
    
    return "VALID" if not errors else "\\n".join(errors)
';