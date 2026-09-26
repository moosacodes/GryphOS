declare module "ical.js" {
  const ICAL: {
    parse(input: string): unknown;
    Component: new (jcal: unknown) => {
      getAllSubcomponents(name: string): unknown[];
    };
    Event: new (comp: unknown) => unknown;
  };
  export default ICAL;
}
