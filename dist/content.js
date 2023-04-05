(()=>{"use strict";var e={826:(e,t,r)=>{e.exports=r(326)},326:(e,t,r)=>{t.fromRange=function(e,t){if(void 0===e)throw new Error('missing required parameter "root"');if(void 0===t)throw new Error('missing required parameter "range"');var r=e.ownerDocument.createRange(),n=t.startContainer,a=t.startOffset;r.setStart(e,0),r.setEnd(n,a);var i=(0,o.default)(r).length;return{start:i,end:i+(0,o.default)(t).length}},t.toRange=function(e){var t=arguments.length>1&&void 0!==arguments[1]?arguments[1]:{};if(void 0===e)throw new Error('missing required parameter "root"');var r=e.ownerDocument,o=r.createRange(),a=r.createNodeIterator(e,i),s=t.start||0,c=t.end||s,d=s-(0,n.default)(a,s),l=a.referenceNode,u=c-s+d,f=u-(0,n.default)(a,u),p=a.referenceNode;return o.setStart(l,d),o.setEnd(p,f),o};var n=a(r(337)),o=a(r(790));function a(e){return e&&e.__esModule?e:{default:e}}var i=4},790:(e,t)=>{function r(e,t){if(!t&&e.firstChild)return e.firstChild;do{if(e.nextSibling)return e.nextSibling;e=e.parentNode}while(e);return e}Object.defineProperty(t,"__esModule",{value:!0}),t.default=function(e){var t="";return function(e,t){for(var n=function(e){return e.startContainer.nodeType===Node.ELEMENT_NODE?e.startContainer.childNodes[e.startOffset]||r(e.startContainer,!0):e.startContainer}(e),o=function(e){return e.endContainer.nodeType===Node.ELEMENT_NODE?e.endContainer.childNodes[e.endOffset]||r(e.endContainer,!0):r(e.endContainer)}(e);n!==o;)t(n),n=r(n)}(e,(function(r){if(r.nodeType===Node.TEXT_NODE){var n=r===e.startContainer?e.startOffset:0,o=r===e.endContainer?e.endOffset:r.textContent.length;t+=r.textContent.slice(n,o)}})),t}},337:(e,t,r)=>{e.exports=r(916).default},916:(e,t)=>{t.default=function(e,t){if(e.whatToShow!==i){var s;try{s=new DOMException(n,"InvalidStateError")}catch(e){(s=new Error(n)).code=11,s.name="InvalidStateError",s.toString=function(){return"InvalidStateError: ".concat(n)}}throw s}var d,l=0,u=e.referenceNode,f=null;if("number"==typeof(d=t)&&isFinite(d)&&Math.floor(d)===d)f={forward:function(){return l<t},backward:function(){return l>t||!e.pointerBeforeReferenceNode}};else{if(!c(t))throw new TypeError(o);f={forward:function(e,t){return e.compareDocumentPosition(t)&a}(u,t)?function(){return!1}:function(){return u!==t},backward:function(){return u!==t||!e.pointerBeforeReferenceNode}}}for(;f.forward();){if(null===(u=e.nextNode()))throw new RangeError(r);l+=u.nodeValue.length}for(e.nextNode()&&(u=e.previousNode());f.backward();){if(null===(u=e.previousNode()))throw new RangeError(r);l-=u.nodeValue.length}if(!c(e.referenceNode))throw new RangeError(r);return l};var r="Iterator exhausted before seek ended.",n="Argument 1 of seek must use filter NodeFilter.SHOW_TEXT.",o="Argument 2 of seek must be an integer or a Text Node.",a=2,i=4,s=3;function c(e){return e.nodeType===s}}},t={};function r(n){var o=t[n];if(void 0!==o)return o.exports;var a=t[n]={exports:{}};return e[n](a,a.exports,r),a.exports}(()=>{const e=[],t=[];function n(r,n){if(r===n)return 0;const o=r;r.length>n.length&&(r=n,n=o);let a=r.length,i=n.length;for(;a>0&&r.charCodeAt(~-a)===n.charCodeAt(~-i);)a--,i--;let s,c,d,l,u=0;for(;u<a&&r.charCodeAt(u)===n.charCodeAt(u);)u++;if(a-=u,i-=u,0===a)return i;let f=0,p=0;for(;f<a;)t[f]=r.charCodeAt(u+f),e[f]=++f;for(;p<i;)for(s=n.charCodeAt(u+p),d=p++,c=p,f=0;f<a;f++)l=s===t[f]?d:d+1,d=e[f],c=e[f]=d>c?l>c?c+1:l:l>d?d+1:l;return c}var o=r(826);const a=32;function i(e,t,r={}){let i=function(e,t){if(void 0===e)throw new Error('missing required parameter "root"');if(void 0===t)throw new Error('missing required parameter "selector"');const{prefix:r,exact:o,suffix:i}=t;if(void 0===o)throw new Error('selector missing required property "exact"');const s=[];let c=-1;for(;-1!==(c=e.textContent.indexOf(o,c+1));)s.push(c);const d=s.map((t=>{let s=0;if(void 0!==r&&(s+=n(e.textContent.slice(Math.max(t-a,0),t),r)),void 0!==i){const r=t+o.length;s+=n(e.textContent.slice(r,r+a),i)}return{index:t,distance:s}}));let l=null,u=1/0;for(const{index:e,distance:t}of d)t<u&&(l=e,u=t);return l&&{start:l,end:l+o.length}}(e,t);return null===i?null:o.toRange(e,i)}const s=e=>{let t=encodeURIComponent(e);for(const r of e.matchAll(/[\p{scx=Hiragana}\p{scx=Katakana}\p{scx=Han}]/gu))t=t.replace(encodeURIComponent(r[0]),r[0]);return t},c=()=>{const e=document.querySelector('link[rel="canonical" i]'),t=new URL(e instanceof HTMLLinkElement&&e.href||location.href);return t.searchParams.delete("p"),t.searchParams.delete("e"),t.searchParams.delete("s"),t.hash="",String(t)};let d,l,u=null;chrome.runtime.onMessage.addListener((e=>{switch(e.type){case"annotate":{const t=getSelection(),r=[];if(t&&!t.isCollapsed&&t.rangeCount>=1){const e=function(e,t){if(void 0===e)throw new Error('missing required parameter "root"');if(void 0===t)throw new Error('missing required parameter "range"');return function(e,t){if(void 0===e)throw new Error('missing required parameter "root"');if(void 0===t)throw new Error('missing required parameter "selector"');let{start:r}=t;if(void 0===r)throw new Error('selector missing required property "start"');if(r<0)throw new Error('property "start" must be a non-negative integer');let{end:n}=t;if(void 0===n)throw new Error('selector missing required property "end"');if(n<0)throw new Error('property "end" must be a non-negative integer');let o=e.textContent.substr(r,n-r),i=Math.max(0,r-a),s=e.textContent.substr(i,r-i),c=Math.min(e.textContent.length,n+a);return{exact:o,prefix:s,suffix:e.textContent.substr(n,c-n)}}(e,o.fromRange(e,t))}(document.body,t.getRangeAt(0));l||r.push(`[${(e=>{const t=new URL(e);return t.protocol=new Map([["http:","anno:"],["https:","annos:"]]).get(t.protocol)??t.protocol,decodeURI(String(t))})(c())}]`,""),r.push(`> [${e.exact.replaceAll("[","").replaceAll("]","").replaceAll("\n","")} ${c()}#${[...e.prefix?[`p=${s(e.prefix)}`]:[],`e=${s(e.exact)}`,...e.suffix?[`s=${s(e.suffix)}`]:[]].join("&")}]`)}const n=l??{title:document.title};u?.close(),u=open(`https://scrapbox.io/${encodeURIComponent(n.projectName??e.annoProjectName)}/${encodeURIComponent(n.title)}?${new URLSearchParams({body:r.join("\n")})}`),l=n;break}case"inject":d?.(),d=(e=>{let t=[];const r=()=>t.forEach((e=>e[0](e[1]))),n=()=>{r(),t=e.flatMap((e=>{const t=i(document.body,e.textQuoteSelector);return t?[[e.cleanUp,e.inject(t)]]:[]}))};let o;n();const a=new MutationObserver((()=>{clearTimeout(o),o=window.setTimeout((()=>{a.disconnect(),n(),s()}))})),s=()=>a.observe(document.body,{subtree:!0,childList:!0,characterData:!0});return s(),()=>{a.disconnect(),r()}})([...e.configs].reverse().map((({textQuoteSelector:e,annotationURL:t,iconSize:r})=>({textQuoteSelector:e,inject:e=>{const n=document.createElement("iframe");n.src=t,n.sandbox.add("allow-popups","allow-popups-to-escape-sandbox","allow-scripts"),n.style.all="revert",n.style.border="none",n.style.width=`${r}px`,n.style.height=`${r}px`,n.style.marginLeft="4px",n.style.marginRight="4px";const o=e.cloneRange();if(0===o.endOffset){const e=document.createNodeIterator(o.commonAncestorContainer,NodeFilter.SHOW_TEXT);let t,r;for(;r=e.nextNode();){if(t&&r===o.endContainer){o.setEndAfter(t);break}t=r}}const a=document.createElement("mark");return a.style.all="revert",a.append(o.extractContents(),n),o.insertNode(a),a},cleanUp:e=>{if(!(e instanceof Element))throw new Error("invalid element. ");e.after(...[...e.childNodes].slice(0,-1)),e.remove()}})))),l=e.existedAnnolink;break;default:throw new Error(`Unknown message type: ${e}`)}})),addEventListener("beforeunload",(()=>{u?.close()}));let f,p=!1;const h=()=>{if(f!==c()){p=!1;const e={type:"urlChange",url:c()};chrome.runtime.sendMessage(e)}f=c()};setInterval((()=>{f=void 0,h()}),6e4);const m=()=>{h(),(()=>{if(p)return;let e;try{e=new URLSearchParams(location.hash)}catch{return}const t=e,r=t.get("e");if(!r)return;const n=getSelection(),o=i(document.body,{prefix:t.get("p")??void 0,exact:r,suffix:t.get("s")??void 0});if(!n||!o)return;n.removeAllRanges(),n.addRange(o);const a=o.startContainer instanceof Element?o.startContainer:o.startContainer.parentElement;a?.scrollIntoView({block:"center"}),p=!0})()};m(),new MutationObserver(m).observe(document,{subtree:!0,childList:!0,characterData:!0})})()})();