import { describe, expect, it } from 'vitest';
import { scanExternalUrls } from '../../src/site/guard.mjs';

/* The build's no-CDN guard. These assert the BEHAVIOUR the rule exists for — "a page may link
   out, but nothing on a page may fetch" — not the shape of the regexes that implement it. */

const BMC = 'https://buymeacoffee.com/passingbypixels';

describe('pages: an external URL is allowed only as a link a human clicks', () => {
  it('passes the Buy me a coffee link in the footer', () => {
    const html = `<footer><a class="coffee" href="${BMC}" target="_blank" rel="noopener">Buy me a coffee</a></footer>`;
    expect(scanExternalUrls('index.html', html)).toEqual([]);
  });

  it('fails a smuggled script tag', () => {
    const out = scanExternalUrls('index.html', '<script src="https://cdn.example.com/tracker.js"></script>');
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('https://cdn.example.com/tracker.js');
    expect(out[0]).toContain('fetch');
  });

  it('fails a remote stylesheet and a remote font import', () => {
    expect(scanExternalUrls('index.html', '<link rel="stylesheet" href="https://fonts.googleapis.com/css?f=x">')).toHaveLength(1);
    expect(scanExternalUrls('index.html', '<style>@import url("https://fonts.googleapis.com/css");</style>')).toHaveLength(1);
  });

  it('fails a remote image even though it is inside an <a>', () => {
    const out = scanExternalUrls('index.html', `<a href="${BMC}"><img src="https://cdn.buymeacoffee.com/button.png"></a>`);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('button.png');
  });

  it('fails a bare external URL that is not a link at all', () => {
    const out = scanExternalUrls('index.html', '<p>fetch("https://api.example.com/beacon")</p>');
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('<a href>');
  });

  it('reports one offence per smuggled URL, not two', () => {
    expect(scanExternalUrls('index.html', '<iframe src="https://evil.example/x"></iframe>')).toHaveLength(1);
  });

  it('passes relative assets and non-http schemes', () => {
    const html = '<link rel="stylesheet" href="./site.css"><img src="../favicon.svg"><pre>chrome://flags/#enable-webmcp-testing</pre>';
    expect(scanExternalUrls('index.html', html)).toEqual([]);
  });

  it('applies the same page rules to an .svg', () => {
    expect(scanExternalUrls('favicon.svg', '<svg xmlns="http://www.w3.org/2000/svg"></svg>')).toEqual([]);
    expect(scanExternalUrls('mark.svg', '<svg><image href="x" src="https://cdn.example.com/a.png"/></svg>')).toHaveLength(1);
  });
});

describe('app code: no external URL at all, allowlist aside', () => {
  it('fails any https:// in a bundle', () => {
    expect(scanExternalUrls('folio/app.js', 'fetch("https://api.example.com/v1")')).toHaveLength(1);
  });

  it('fails a CDN import in a stylesheet', () => {
    expect(scanExternalUrls('site.css', '@import "https://cdn.example.com/reset.css";')).toHaveLength(1);
  });

  it('does not fail on a link a human clicks, because app code has no humans clicking it', () => {
    expect(scanExternalUrls('folio/app.js', `const bmc = "${BMC}";`)).toHaveLength(1);
  });

  it('passes the vendored strings the allowlist names', () => {
    const vendored =
      'createElementNS("http://www.w3.org/2000/svg");' +
      'src=`https://www.youtube-nocookie.com/embed/${id}?autoplay=1`;' +
      'src=`https://player.vimeo.com/video/${id}`;' +
      'src=`https://www.loom.com/embed/${id}`;' +
      'href="https://origamilabs.nl"';
    expect(scanExternalUrls('folio/chunk-abc.js', vendored)).toEqual([]);
  });

  it('does not police deck payloads or data files', () => {
    expect(scanExternalUrls('folio/sample/welcome.origami.html'.replace('.html', '.json'), 'https://anything')).toEqual([]);
  });
});
