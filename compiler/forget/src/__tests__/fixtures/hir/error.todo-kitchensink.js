function foo([a, b], { c, d, e = "e" }, f = "f", ...args) {
  let i = 0;
  var x = [];

  class Bar {
    #secretSauce = 42;
    constructor() {
      console.log(this.#secretSauce);
    }
  }

  const g = { ...a, b() {}, c: () => {} };
  const h = [...b];
  new c(...args);
  c(...args);
  const [y, ...yy] = useState(0);
  const { z, aa = "aa", ...zz } = useCustom();

  <Button {...args}></Button>;
  <Button xlink:href="localhost:3000"></Button>;
  <Button haha={1}></Button>;
  <Button>{/** empty */}</Button>;
  <DesignSystem.Button />;

  const j = function bar([quz, qux], ...args) {};

  for (; i < 3; i += 1) {
    x.push(i);
  }
  for (; i < 3; ) {
    break;
  }
  for (;;) {
    break;
  }

  graphql`
    ${g}
  `;

  graphql`\\t\n`;

  for (const c of [1, 2]) {
  }

  for (let x in { a: 1 }) {
  }

  do {} while (i < 3);

  let updateIdentifier = 0;
  --updateIdentifier;
  ++updateIdentifier;
  updateIdentifier.y++;
  updateIdentifier.y--;

  switch (i) {
    case 1 + 1: {
    }
    case foo(): {
    }
    case x.y: {
    }
    default: {
    }
  }
}
