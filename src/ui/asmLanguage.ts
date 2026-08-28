import { StreamLanguage } from "@codemirror/language";

const KEYWORDS = /^(ldi|mov|add|addc|sub|subc|and|or|xor|not|shl|shr|rol|ror|rolc|rorc|ldb|ldw|stb|stw|b|bz|bnz|bn|bnn|bc|bnc|nop|hlt)$/;

const asmLanguage = StreamLanguage.define({
  name: "gde1-asm",
  token(stream) {
    if (stream.eatSpace()) return null;
    if (stream.match(/;.*/, true)) return "comment";
    if (stream.match(/^%r[0-9]+/)) return "atom";
    if (stream.match(/^\$[\dxX0-9a-fA-F-]+/)) return "number";
    const word = stream.match(/^[A-Za-z][\w]*/);
    if (word) {
      if (KEYWORDS.test((word as RegExpMatchArray)[0].toLowerCase())) return "keyword";
      return "variableName";
    }
    stream.next();
    return null;
  },
});

export const asmLanguageSupport = () => asmLanguage;
