import hljs from 'highlight.js/lib/core';
import typescript from 'highlight.js/lib/languages/typescript';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import bash from 'highlight.js/lib/languages/bash';
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('json', json);
hljs.registerLanguage('bash', bash);
export function highlight(source, file='example.ts') {
  const language=file.endsWith('.json')?'json':file==='terminal'||file.endsWith('.sh')?'bash':file.endsWith('.js')||file.endsWith('.mjs')?'javascript':'typescript';
  return hljs.highlight(source,{language,ignoreIllegals:true}).value;
}
