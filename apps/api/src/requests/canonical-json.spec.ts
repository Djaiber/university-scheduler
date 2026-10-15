import { canonicalJson, sha256 } from './canonical-json';

describe('canonicalJson', () => {
  it('ignora el orden de las claves y omite undefined', () => {
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: undefined }] })).toBe('{"a":[{"d":2}],"b":1}');
    expect(sha256(canonicalJson({ x: 1, y: 2 }))).toBe(sha256(canonicalJson({ y: 2, x: 1 })));
  });
});
