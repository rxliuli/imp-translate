import { describe, it, expect } from 'vitest'
import {
  countSegments,
  decodeSegments,
  encodeSegments,
  escapeSegmentText,
  unescapeSegmentText,
} from './segments'

describe('encodeSegments', () => {
  it('wraps each segment in <i id="N">', () => {
    expect(encodeSegments(['Click ', 'here', ' for details'])).toBe(
      '<i id="0">Click </i><i id="1">here</i><i id="2"> for details</i>',
    )
  })

  it('escapes segment text but not the tags', () => {
    expect(encodeSegments(['a < b & c > d', '<i id="9">x</i>'])).toBe(
      '<i id="0">a &lt; b &amp; c &gt; d</i><i id="1">&lt;i id="9"&gt;x&lt;/i&gt;</i>',
    )
  })

  it('encodes an empty list as an empty string', () => {
    expect(encodeSegments([])).toBe('')
    expect(decodeSegments('', 0)).toEqual([])
  })
})

describe('escape/unescape', () => {
  it('round-trips', () => {
    const s = `Tom & Jerry <3 "quotes" 'single' &amp;`
    expect(unescapeSegmentText(escapeSegmentText(s))).toBe(s)
  })

  it('unescapes numeric entities from translators', () => {
    expect(unescapeSegmentText('it&#39;s &quot;ok&quot;')).toBe(`it's "ok"`)
  })
})

describe('decodeSegments', () => {
  it('round-trips without trimming', () => {
    const segs = ['  Click ', 'here', ' for <details> & more\n']
    expect(decodeSegments(encodeSegments(segs), segs.length)).toEqual(segs)
  })

  it('returns segments in output order, not id order', () => {
    expect(decodeSegments('<i id="1">B</i><i id="0">A</i>', 2)).toEqual(['B', 'A'])
    expect(
      decodeSegments('<i id="2">C</i><i id="0">A</i><i id="1">B</i>', 3),
    ).toEqual(['C', 'A', 'B'])
  })

  it('merges outside text by output order when tags are reordered', () => {
    expect(decodeSegments('<i id="1">Bb</i>, <i id="0">Aa</i>.', 2)).toEqual(['Bb, ', 'Aa.'])
  })

  it('allows whitespace between and around tags', () => {
    expect(decodeSegments(' <i id="0">A</i>\n <i id="1">B</i> ', 2)).toEqual([
      ' A\n ',
      'B ',
    ])
  })

  it('tolerates attribute quoting/spacing/case variants', () => {
    expect(
      decodeSegments(`<I id='0'>A</I><i id=1>B</i ><i  id = "2" >C</i>`, 3),
    ).toEqual(['A', 'B', 'C'])
  })

  it('rejects empty segments (blank segments are never sent, see isPassthroughSegment)', () => {
    expect(decodeSegments('<i id="0"></i><i id="1">B</i>', 2)).toBeNull()
  })

  it('rejects a missing id', () => {
    expect(decodeSegments('<i id="0">A</i><i id="2">C</i>', 3)).toBeNull()
  })

  it('rejects a duplicate id', () => {
    expect(decodeSegments('<i id="0">A</i><i id="0">B</i>', 2)).toBeNull()
  })

  it('rejects an out-of-range id', () => {
    expect(decodeSegments('<i id="0">A</i><i id="1">B</i><i id="2">C</i>', 2)).toBeNull()
  })

  it('merges text after a tag onto that segment (output order)', () => {
    // Google ja: sentence-final 。 lands outside the last tag (id 0).
    expect(
      decodeSegments(
        '<i id="2">&lt;新&gt;リリースの詳細などについては、</i><i id="1">こちらを</i><i id="0">クリックしてください</i>。',
        3,
      ),
    ).toEqual(['<新>リリースの詳細などについては、', 'こちらを', 'クリックしてください。'])
  })

  it('keeps whitespace pushed between tags on the preceding segment', () => {
    // Google de: inter-segment spaces move outside the tags.
    expect(
      decodeSegments(
        '<i id="0">Verwenden Sie</i> <i id="1">npm install</i> <i id="2">, um &quot;es&quot; schnell einzurichten.</i>',
        3,
      ),
    ).toEqual(['Verwenden Sie ', 'npm install ', ', um "es" schnell einzurichten.'])
  })

  it('merges text before the first tag onto the start of the first output segment', () => {
    expect(decodeSegments('« <i id="1">B</i><i id="0">A</i>', 2)).toEqual(['« B', 'A'])
  })

  it('merges a few stray words and keeps segment whitespace untrimmed', () => {
    expect(
      decodeSegments('<i id="0"> Lesen Sie </i>jetzt<i id="1"> die Doku </i>', 2),
    ).toEqual([' Lesen Sie jetzt', ' die Doku '])
  })

  it('accepts any amount of outside text as long as every segment ends up non-empty', () => {
    expect(decodeSegments('<i id="0">AB</i>xyz<i id="1">CD</i>', 2)).toEqual(['ABxyz', 'CD'])
    // Google on Wikipedia #42: most of the sentence outside, link texts inside.
    expect(
      decodeSegments(
        '2024年，知识共享组织与<i id="0">新加坡政府</i>和<i id="1">联合国开发计划署</i>的合作伙伴',
        2,
      ),
    ).toEqual(['2024年，知识共享组织与新加坡政府和', '联合国开发计划署的合作伙伴'])
  })

  it('returns null when a segment is empty after merging outside text', () => {
    // The last tag is empty and nothing follows it: that node would show nothing.
    expect(decodeSegments('<i id="0">text</i><i id="1"></i>', 2)).toBeNull()
    expect(decodeSegments('<i id="0"></i>text<i id="1"></i>', 2)).toBeNull()
    // Whitespace-only is empty too.
    expect(decodeSegments('<i id="0">A</i><i id="1"> </i>', 2)).toBeNull()
    // An empty tag followed by outside text is fine: the text merges into it.
    expect(decodeSegments('<i id="0">A</i><i id="1"></i>B', 2)).toEqual(['A', 'B'])
  })

  it('keeps outside whitespace on the preceding segment', () => {
    expect(decodeSegments('<i id="0">A</i>\n   \n<i id="1">B</i>', 2)).toEqual([
      'A\n   \n',
      'B',
    ])
  })

  it('rejects nested or unclosed tags', () => {
    expect(decodeSegments('<i id="0">A<i id="1">B</i></i>', 2)).toBeNull()
    expect(decodeSegments('<i id="0">A</i><i id="1">B', 2)).toBeNull()
  })

  it('rejects plain text with no tags', () => {
    expect(decodeSegments('just text', 1)).toBeNull()
    expect(decodeSegments('just text', 0)).toBeNull()
  })

  it('rejects stray segment tags outside the matched ones', () => {
    expect(decodeSegments('<i id="0">A</i></i><i id="1">B</i>', 2)).toBeNull()
  })

  it('keeps other markup inside a segment as text', () => {
    expect(decodeSegments('<i id="0">a <b>b</b></i>', 1)).toEqual(['a <b>b</b>'])
  })
})

describe('decodeSegments safety valves', () => {
  it('strips a markdown code fence around the whole output', () => {
    const enc = '<i id="0">你好 </i><i id="1">世界</i>'
    expect(decodeSegments('```html\n' + enc + '\n```', 2)).toEqual(['你好 ', '世界'])
    expect(decodeSegments('```\n' + enc + '\n```\n', 2)).toEqual(['你好 ', '世界'])
    expect(decodeSegments('```' + enc + '```', 2)).toEqual(['你好 ', '世界'])
  })

  it('leaves backticks inside segments alone', () => {
    expect(decodeSegments('<i id="0">run ```npm i``` </i><i id="1">now</i>', 2)).toEqual([
      'run ```npm i``` ',
      'now',
    ])
  })

  it('accepts long outside text on long paragraphs', () => {
    const long = 'x'.repeat(500)
    const outside = 'This sentence was moved out of the tags by the model!'
    expect(decodeSegments(`<i id="0">${long}</i>${outside}<i id="1">${long}</i>`, 2)).toEqual([
      long + outside,
      long,
    ])
  })
})

describe('countSegments', () => {
  it('counts encoded tags', () => {
    expect(countSegments(encodeSegments(['a', 'b', 'c']))).toBe(3)
    expect(countSegments('plain')).toBe(0)
  })
})
