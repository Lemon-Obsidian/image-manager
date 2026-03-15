import { FileNameNormalizer } from '../FileNameNormalizer';

describe('FileNameNormalizer.normalizeString', () => {
  const n = FileNameNormalizer.normalizeString;

  describe('기본 변환', () => {
    it('대문자 → 소문자', () => expect(n('HelloWorld')).toBe('helloworld'));
    it('앞뒤 공백 제거', () => expect(n('  hello  ')).toBe('hello'));
    it('공백 → 하이픈', () => expect(n('hello world')).toBe('hello-world'));
    it('빈 문자열 → 빈 문자열', () => expect(n('')).toBe(''));
  });

  describe('특수문자 처리', () => {
    it('허용 외 ASCII 특수문자 제거', () => expect(n('hello!@#$world')).toBe('helloworld'));
    it('하이픈은 유지', () => expect(n('hello-world')).toBe('hello-world'));
    it('숫자 유지', () => expect(n('image123')).toBe('image123'));
  });

  describe('하이픈 정리', () => {
    it('연속 하이픈 → 단일 하이픈', () => expect(n('hello---world')).toBe('hello-world'));
    it('앞끝 하이픈 제거', () => expect(n('-hello-')).toBe('hello'));
    it('공백+특수문자 → 하이픈 하나로', () => expect(n('hello  !!  world')).toBe('hello-world'));
  });

  describe('CJK 문자 허용', () => {
    it('한글 유지', () => expect(n('안녕 세계')).toBe('안녕-세계'));
    it('한자 유지', () => expect(n('你好世界')).toBe('你好世界'));
    it('히라가나 유지', () => expect(n('こんにちは')).toBe('こんにちは'));
    it('가타카나 유지', () => expect(n('コンニチハ')).toBe('コンニチハ'));
    it('한글+영문 혼합', () => expect(n('hello 세계')).toBe('hello-세계'));
    it('한자+영문 혼합', () => expect(n('2024年 report')).toBe('2024年-report'));
  });

  describe('실제 파일명 패턴', () => {
    it('스크린샷 파일명', () => expect(n('Screenshot 2024-01-15 at 12.34.56')).toBe('screenshot-2024-01-15-at-123456'));
    it('한글 노트 제목', () => expect(n('프로젝트 회의록 2024')).toBe('프로젝트-회의록-2024'));
    it('이미 정규화된 이름', () => expect(n('hello-world-123')).toBe('hello-world-123'));
  });
});
