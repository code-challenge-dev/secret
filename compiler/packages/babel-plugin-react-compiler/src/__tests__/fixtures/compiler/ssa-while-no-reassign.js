function foo() {
  let x = 1;
  while (x < 10) {
    x + 1;
  }

  return x;
}

export const FIXTURE_ENTRYPOINT = {
  fn: foo,
  params: [],
  isComponent: false,
};
