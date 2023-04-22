(()=>{"use strict";var e={826:(e,t,n)=>{e.exports=n(326)},326:(e,t,n)=>{t.fromRange=function(e,t){if(void 0===e)throw new Error('missing required parameter "root"');if(void 0===t)throw new Error('missing required parameter "range"');var n=e.ownerDocument.createRange(),r=t.startContainer,a=t.startOffset;n.setStart(e,0),n.setEnd(r,a);var i=(0,o.default)(n).length;return{start:i,end:i+(0,o.default)(t).length}},t.toRange=function(e){var t=arguments.length>1&&void 0!==arguments[1]?arguments[1]:{};if(void 0===e)throw new Error('missing required parameter "root"');var n=e.ownerDocument,o=n.createRange(),a=n.createNodeIterator(e,i),s=t.start||0,c=t.end||s,d=s-(0,r.default)(a,s),u=a.referenceNode,f=c-s+d,l=f-(0,r.default)(a,f),p=a.referenceNode;return o.setStart(u,d),o.setEnd(p,l),o};var r=a(n(337)),o=a(n(790));function a(e){return e&&e.__esModule?e:{default:e}}var i=4},790:(e,t)=>{function n(e,t){if(!t&&e.firstChild)return e.firstChild;do{if(e.nextSibling)return e.nextSibling;e=e.parentNode}while(e);return e}Object.defineProperty(t,"__esModule",{value:!0}),t.default=function(e){var t="";return function(e,t){for(var r=function(e){return e.startContainer.nodeType===Node.ELEMENT_NODE?e.startContainer.childNodes[e.startOffset]||n(e.startContainer,!0):e.startContainer}(e),o=function(e){return e.endContainer.nodeType===Node.ELEMENT_NODE?e.endContainer.childNodes[e.endOffset]||n(e.endContainer,!0):n(e.endContainer)}(e);r!==o;)t(r),r=n(r)}(e,(function(n){if(n.nodeType===Node.TEXT_NODE){var r=n===e.startContainer?e.startOffset:0,o=n===e.endContainer?e.endOffset:n.textContent.length;t+=n.textContent.slice(r,o)}})),t}},337:(e,t,n)=>{e.exports=n(916).default},916:(e,t)=>{t.default=function(e,t){if(e.whatToShow!==i){var s;try{s=new DOMException(r,"InvalidStateError")}catch(e){(s=new Error(r)).code=11,s.name="InvalidStateError",s.toString=function(){return"InvalidStateError: ".concat(r)}}throw s}var d,u=0,f=e.referenceNode,l=null;if("number"==typeof(d=t)&&isFinite(d)&&Math.floor(d)===d)l={forward:function(){return u<t},backward:function(){return u>t||!e.pointerBeforeReferenceNode}};else{if(!c(t))throw new TypeError(o);l={forward:function(e,t){return e.compareDocumentPosition(t)&a}(f,t)?function(){return!1}:function(){return f!==t},backward:function(){return f!==t||!e.pointerBeforeReferenceNode}}}for(;l.forward();){if(null===(f=e.nextNode()))throw new RangeError(n);u+=f.nodeValue.length}for(e.nextNode()&&(f=e.previousNode());l.backward();){if(null===(f=e.previousNode()))throw new RangeError(n);u-=f.nodeValue.length}if(!c(e.referenceNode))throw new RangeError(n);return u};var n="Iterator exhausted before seek ended.",r="Argument 1 of seek must use filter NodeFilter.SHOW_TEXT.",o="Argument 2 of seek must be an integer or a Text Node.",a=2,i=4,s=3;function c(e){return e.nodeType===s}}},t={};function n(r){var o=t[r];if(void 0!==o)return o.exports;var a=t[r]={exports:{}};return e[r](a,a.exports,n),a.exports}(()=>{const e=[],t=[];function r(n,r){if(n===r)return 0;const o=n;n.length>r.length&&(n=r,r=o);let a=n.length,i=r.length;for(;a>0&&n.charCodeAt(~-a)===r.charCodeAt(~-i);)a--,i--;let s,c,d,u,f=0;for(;f<a&&n.charCodeAt(f)===r.charCodeAt(f);)f++;if(a-=f,i-=f,0===a)return i;let l=0,p=0;for(;l<a;)t[l]=n.charCodeAt(f+l),e[l]=++l;for(;p<i;)for(s=r.charCodeAt(f+p),d=p++,c=p,l=0;l<a;l++)u=s===t[l]?d:d+1,d=e[l],c=e[l]=d>c?u>c?c+1:u:u>d?d+1:u;return c}var o=n(826);const a=32;function i(e,t,n={}){let i=function(e,t){if(void 0===e)throw new Error('missing required parameter "root"');if(void 0===t)throw new Error('missing required parameter "selector"');const{prefix:n,exact:o,suffix:i}=t;if(void 0===o)throw new Error('selector missing required property "exact"');const s=[];let c=-1;for(;-1!==(c=e.textContent.indexOf(o,c+1));)s.push(c);const d=s.map((t=>{let s=0;if(void 0!==n&&(s+=r(e.textContent.slice(Math.max(t-a,0),t),n)),void 0!==i){const n=t+o.length;s+=r(e.textContent.slice(n,n+a),i)}return{index:t,distance:s}}));let u=null,f=1/0;for(const{index:e,distance:t}of d)t<f&&(u=e,f=t);return u&&{start:u,end:u+o.length}}(e,t);return null===i?null:o.toRange(e,i)}const s=e=>{let t=encodeURIComponent(e);for(const n of e.matchAll(/[\p{scx=Hiragana}\p{scx=Katakana}\p{scx=Han}]/gu))t=t.replace(encodeURIComponent(n[0]),n[0]);return t},c=()=>{const e=document.querySelector('link[rel="canonical" i]'),t=new URL(e instanceof HTMLLinkElement&&e.href||location.href);return t.searchParams.delete("p"),t.searchParams.delete("e"),t.searchParams.delete("s"),t.hash="",String(t)};let d,u,f;chrome.runtime.onMessage.addListener((async e=>{switch(e.type){case"annotate":{const t=[],n=document.title||(new Date).toLocaleString(),r=getSelection(),i=r&&!r.isCollapsed&&r.rangeCount>=1;if(!u){t.push(`[${n} ${c()}]`);const e=window.document.querySelector('meta[property="og:image" i]'),r=e instanceof window.HTMLMetaElement&&e.content;r&&t.push(`[${r}#.png]`);const o=window.document.querySelector('meta[name="description" i]'),a=window.document.querySelector('meta[property="og:description" i]'),s=a instanceof window.HTMLMetaElement&&a.content||o instanceof window.HTMLMetaElement&&o.content;s&&t.push(...s.split("\n").map((e=>`> ${e}`)));const d=window.document.querySelector('meta[name="keywords" i]'),u=d instanceof window.HTMLMetaElement&&d.content;u&&t.push(u),t.push(`[${(e=>{const t=new URL(e);return t.protocol=new Map([["http:","anno:"],["https:","annos:"]]).get(t.protocol)??t.protocol,decodeURI(String(t))})(c())}]`),i&&t.push("")}if(i){const e=function(e,t){if(void 0===e)throw new Error('missing required parameter "root"');if(void 0===t)throw new Error('missing required parameter "range"');return function(e,t){if(void 0===e)throw new Error('missing required parameter "root"');if(void 0===t)throw new Error('missing required parameter "selector"');let{start:n}=t;if(void 0===n)throw new Error('selector missing required property "start"');if(n<0)throw new Error('property "start" must be a non-negative integer');let{end:r}=t;if(void 0===r)throw new Error('selector missing required property "end"');if(r<0)throw new Error('property "end" must be a non-negative integer');let o=e.textContent.substr(n,r-n),i=Math.max(0,n-a),s=e.textContent.substr(i,n-i),c=Math.min(e.textContent.length,r+a);return{exact:o,prefix:s,suffix:e.textContent.substr(r,c-r)}}(e,o.fromRange(e,t))}(document.body,r.getRangeAt(0));t.push(`[🍀 ${c()}#${[...e.prefix?[`p=${s(e.prefix)}`]:[],`e=${s(e.exact)}`,...e.suffix?[`s=${s(e.suffix)}`]:[]].join("&")}]`),t.push(...e.exact.trim().replaceAll(/^ +/gm,"").replaceAll(/\n{2,}/g,"\n").split("\n").map((e=>`> ${e}`)))}const d=u??{title:n},p={type:"open",url:`https://scrapbox.io/${encodeURIComponent(d.projectName??e.annoProjectName)}/${encodeURIComponent(d.title)}?${new URLSearchParams({body:t.join("\n")})}`};chrome.runtime.sendMessage(p),await new Promise((e=>setTimeout(e,5e3))),f=void 0,l();break}case"inject":d?.(),d=(e=>{let t=e.map((e=>({config:e})));const n=()=>{r.disconnect(),t=t.map((({config:e,cleanUp:t,range:n})=>{let r=t,o=n;const a=i(document.body,e.textQuoteSelector);return o?.startContainer===a?.startContainer&&o?.startOffset===a?.startOffset&&o?.endContainer===a?.endContainer&&o?.endOffset===a?.endOffset||(r?.(),o=i(document.body,e.textQuoteSelector),r=o?e.inject(o):void 0,o=i(document.body,e.textQuoteSelector)),{config:e,cleanUp:r,range:o}})),r.observe(document.body,{subtree:!0,childList:!0,characterData:!0})},r=new MutationObserver(n);return n(),()=>{r.disconnect();for(const{cleanUp:e}of t)e?.()}})(e.configs.map((({textQuoteSelector:e,annotations:t})=>({textQuoteSelector:e,inject:e=>{const n=[],r=e.cloneRange();r.startContainer instanceof Text&&(r.setStart(r.startContainer.splitText(r.startOffset),0),n.push(r.startContainer));const o=document.createNodeIterator(r.commonAncestorContainer,NodeFilter.SHOW_ALL);let a,i=!1;for(;(a=o.nextNode())&&a!==r.endContainer;)i&&a instanceof Text&&n.push(a),a===r.startContainer&&(i=!0);r.endContainer instanceof Text&&(r.endContainer.splitText(r.endOffset),n.push(r.endContainer));const s=n.flatMap((e=>{if(!e.textContent?.trim())return[];const t=document.createElement("mark");return t.style.all="revert",e.after(t),t.append(e),[t]})),c=t.map((({url:e,size:t})=>{const n=document.createElement("iframe");return n.src=e,n.sandbox.add("allow-popups","allow-popups-to-escape-sandbox","allow-scripts"),n.style.all="revert",n.style.border="none",n.style.width=`${t}px`,n.style.height=`${t}px`,n}));return s.at(-1)?.after(...c),()=>{for(const e of s)e.after(...e.childNodes),e.remove();for(const e of c)e.remove()}}})))),u=e.existedAnnolink;break;default:throw new Error(`Unknown contentMessage type: ${e}`)}}));const l=()=>{if(f!==c()){const e={type:"urlChange",url:c()};chrome.runtime.sendMessage(e)}f=c()};setInterval((()=>{f=void 0,l()}),6e4);const p=()=>{l(),(()=>{let e;try{e=new URLSearchParams(location.hash)}catch{return}const t=e,n=t.get("e");if(!n)return;const r=getSelection(),o=i(document.body,{prefix:t.get("p")??void 0,exact:n,suffix:t.get("s")??void 0});if(!r||!o)return;r.removeAllRanges(),r.addRange(o);const a=o.startContainer instanceof Element?o.startContainer:o.startContainer.parentElement;a?.scrollIntoView({block:"center"});const s=new URL(location.href);s.hash="",history.replaceState(null,"",s)})()};p(),new MutationObserver(p).observe(document,{subtree:!0,childList:!0,characterData:!0})})()})();