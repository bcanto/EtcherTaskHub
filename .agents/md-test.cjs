const puppeteer=require('C:/Users/brnca/AppData/Local/Temp/puppeteer-install/node_modules/puppeteer');

const SAMPLE=`# Site Meeting — Daltech HR Module

**Date:** 6 Sep 2026
**Attendees:** Bruna Canto, Sam Wignall, Daltech ops

## Decisions

- Payroll integration proceeds using the **Humanz connector**
- Daltech to issue a new API key by *Friday*
- Org chart import deferred to phase 2

## Actions

1. Sam to chase the API key
2. Bruna to draft the pro forma
   - include approved timesheet hours only
   - flag anything over 40h
3. Review at next standup

## Risk

> Payroll integration is the high-risk item. Without the key by Friday the
> go-live date slips.

| Item | Owner | Due |
|---|---|---|
| API key | Daltech | 11 Sep |
| Pro forma | Bruna | 12 Sep |

Config snippet:

\`\`\`
HUMANZ_API_KEY=xxxx
HUMANZ_ENV=prod
\`\`\`

Use \`npm run sync\` after updating. See [the runbook](https://example.com/runbook).

---

~~Cancelled:~~ the legacy import path.`;

(async()=>{
  const b=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:'new',args:['--no-sandbox'],defaultViewport:{width:1500,height:950}});
  const p=await b.newPage();
  p.on('pageerror',e=>console.log('PAGEERROR: '+e.message));
  await p.goto('http://localhost:3001/',{waitUntil:'networkidle2'});
  await new Promise(r=>setTimeout(r,1200));
  if(await p.$('#login-email')){
    await p.type('#login-email','b.canto@etchersolutions.com');
    await p.type('#login-password','TaskHub123');
    await p.keyboard.press('Enter');
    await new Promise(r=>setTimeout(r,1800));
  }
  const res=await p.evaluate(md=>{
    const detected=_looksLikeMarkdown(md);
    const html=_mdToHtml(md);
    const d=document.createElement('div');d.innerHTML=html;
    const count=t=>d.querySelectorAll(t).length;
    return {detected,html,
      counts:{h1:count('h1'),h2:count('h2'),ul:count('ul'),ol:count('ol'),li:count('li'),
        strong:count('strong'),em:count('em'),s:count('s'),code:count('code'),pre:count('pre'),
        blockquote:count('blockquote'),table:count('table'),th:count('th'),td:count('td'),hr:count('hr'),a:count('a'),p:count('p')},
      nestedLi: d.querySelectorAll('ol > li ul > li').length,
      linkHref: d.querySelector('a')?.getAttribute('href'),
      preText: d.querySelector('pre')?.textContent.trim(),
      leftoverMarkers: /(\*\*|^#{1,3}\s|^\s*\|)/m.test(d.textContent)
    };
  },SAMPLE);
  console.log('detected as markdown:',res.detected);
  console.log('counts:',JSON.stringify(res.counts));
  console.log('nested li under ol:',res.nestedLi);
  console.log('link href:',res.linkHref);
  console.log('pre text:',JSON.stringify(res.preText));
  console.log('leftover raw markers in text:',res.leftoverMarkers);
  console.log('\n--- HTML ---\n'+res.html.replace(/></g,'>\n<'));
  await b.close();
})().catch(e=>{console.error('FAIL',e.message);process.exit(1)});
