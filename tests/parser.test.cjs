const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const context = {};
vm.runInNewContext(source.slice(0, source.indexOf('  // ===== SM-2 ALGORITHM =====')) +
  'globalThis.Parser = Parser;})();', context);
const parse = text => JSON.parse(JSON.stringify(context.Parser.extractCards(text, 'Wissen/Test.md')));

test('ordinary cards preserve deck, tags and stable IDs', () => {
  const [card] = parse('## Lernkarten #MPP2/Test\nQ: Frage?\nA: Antwort.');
  assert.equal(card.question, 'Frage?');
  assert.equal(card.answer, 'Antwort.');
  assert.equal(card.deck, 'Test');
  assert.deepEqual(card.tags, ['MPP2/Test']);
  assert.equal(card.id, parse('## Lernkarten #MPP2/Test\nQ: Frage?\n![[bild.png]]\nA: Ergänzung.')[0].id);
});

test('all learning sections are imported with their own tags', () => {
  const cards = parse('## Lernkarten #MPP2/A\nQ: Eins?\nA: Eins.\n## Notizen\nQ: Ignorieren?\nA: Ignorieren.\n## Lernkarten #MPP2/B\nQ: Zwei?\nA: Zwei.');
  assert.equal(cards.length, 2);
  assert.deepEqual(cards.map(c => c.tags), [['MPP2/A'], ['MPP2/B']]);
  assert.equal(cards[0].answer, 'Eins.');
});

test('standalone A marker accepts tables and multiple paragraphs', () => {
  const [card] = parse('## Lernkarten\nQ: Vergleich?\nA:\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n**Merke:** Unterschied.');
  assert.equal(card.question, 'Vergleich?');
  assert.equal(card.answer, '| A | B |\n| --- | --- |\n| 1 | 2 |\n\n**Merke:** Unterschied.');
});

test('code fences preserve indentation and literal card markers', () => {
  const block = '```text\n  Q: Beispiel\n  A: Beispiel\n## Lernkarten #Falsch\n<!-- Codekommentar -->\n```';
  const cards = parse('## Lernkarten #MPP2/Code\nQ: Code?\nA:\n' + block + '\nQ: Danach?\nA: Ja.');
  assert.equal(cards.length, 2);
  assert.equal(cards[0].answer, block);
  assert.deepEqual(cards[1].tags, ['MPP2/Code']);
});

test('source comments never become visible answers or phantom sections', () => {
  const cards = parse('<!--\n## Lernkarten #Falsch\nQ: Unsichtbar?\nA: Nein.\n-->\n## Lernkarten #MPP2/Test\nQ: Sichtbar?\nA: Text.<!-- Quelle -->\n<!-- Quellen:\nQ: Keine neue Karte?\n-->\nWeiter.');
  assert.equal(cards.length, 1);
  assert.equal(cards[0].answer.replace(/\n+/g, '\n'), 'Text.\nWeiter.');
});

test('Word paste cleanup and multiline questions remain supported', () => {
  const [card] = parse('## Lernkarte #MPP2/Test\r\n&#x20;Q: Frage?\\\r\n&nbsp;![[bild.png]]\r\n&#32;A: Antwort.\\');
  assert.equal(card.question, 'Frage?\n![[bild.png]]');
  assert.equal(card.answer, 'Antwort.');
});

test('multiple choice options and explanation remain intact', () => {
  const [card] = parse('## Lernkarten #MPP2/Test\nQ: Richtig?\n- [x] Ja\n- [ ] Nein\nA:\n\nErklärung.');
  assert.deepEqual(card.options, [{ text: 'Ja', correct: true }, { text: 'Nein', correct: false }]);
  assert.equal(card.answer, 'Erklärung.');
});

test('empty answers do not create ordinary cards', () => {
  assert.equal(parse('## Lernkarten\nQ: Offen?\nA:\n\n').length, 0);
});

test('fenced examples outside learning sections cannot create cards', () => {
  assert.equal(parse('```md\n## Lernkarten\nQ: Beispiel?\nA: Beispiel.\n```').length, 0);
});

test('folder import fetches only Markdown and retains the image index', async () => {
  const appContext = { console, localStorage: { setItem() {} } };
  vm.runInNewContext(source.slice(0, source.indexOf('  // ===== SERVICE WORKER & PWA =====')) +
    'globalThis.App = App; globalThis.GitHub = GitHub;})();', appContext);
  const { App, GitHub } = appContext;
  const requested = [];
  GitHub.fetchTree = async () => [
    { path: '02_Wissen/Test.md', sha: 'note' },
    { path: '02_Wissen/assets/bild.png', sha: 'image' },
    { path: '02_Wissen/Quelle.pdf', sha: 'pdf' },
    { path: 'AndererOrdner/Test.md', sha: 'other' },
  ];
  GitHub.fetchFile = async (_owner, _repo, _branch, file) => {
    requested.push(file);
    return '## Lernkarten #MPP2/Test\nQ: Frage?\nA: Antwort.';
  };
  App.config = { owner: 'example', repo: 'cards', branch: 'main', folder: '02_Wissen' };
  App.showScreen = () => {};
  App.showToast = message => assert.fail(message);
  await App.loadCards();
  assert.deepEqual(requested, ['02_Wissen/Test.md']);
  assert.equal(App.allCards.length, 1);
  assert.equal(App.imageIndex.get('bild.png').path, '02_Wissen/assets/bild.png');
});
