import mermaid from 'mermaid';
mermaid.initialize({ startOnLoad: false });
const isValid = await mermaid.parse('graph TD; A-->B;');
console.log("Valid:", isValid);
