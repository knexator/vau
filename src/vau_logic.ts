import { reversedForEach } from "./kommon/kommon";
import grammar from "./sexpr.pegjs?raw";
import * as peggy from "peggy";
// import { Pair, Sexpr } from "./vau_logic";
// import { Sexpr, Pair, Atom } from "./vau_logic";
// import { Address, Pair, Sexpr, cloneSexpr, getAtAddress } from "./vau_logic";

export const parseSexpr: (input: string) => Sexpr = (() => {
  const parser = peggy.generate(grammar);
  return x => parser.parse(x);
})();
export type Atom = {
  type: "atom";
  value: string;
};
export type Pair = {
  type: "pair";
  left: Sexpr;
  right: Sexpr;
};
export type Sexpr = Atom | Pair; export type Address = boolean[];
export function getAtAddress(molecule: Sexpr, address: Address): Sexpr {
  let result = molecule;
  for (let k = 0; k < address.length; k++) {
    if (result.type === "atom") throw new Error(`cant access ${molecule} at ${address}`);
    result = address[k] ? result.left : result.right;
  }
  return result;
}
export function cloneSexpr(sexpr: Sexpr): Sexpr {
  if (sexpr.type === "atom") {
    return { type: "atom", value: sexpr.value };
  } else {
    return {
      type: "pair",
      left: cloneSexpr(sexpr.left),
      right: cloneSexpr(sexpr.right)
    };
  }
}
/** returns a copy */
export function setAtAddress(molecule: Sexpr, address: Address, value: Sexpr): Sexpr {
  if (address.length === 0) return value;
  const result = cloneSexpr(molecule);
  let parent = result;
  for (let k = 0; k < address.length - 1; k++) {
    if (parent.type === "atom") throw new Error(`cant set ${molecule} at address ${address}`);
    parent = address[k] ? parent.left : parent.right;
  }
  if (parent.type === "atom") throw new Error(`cant set ${molecule} at address ${address}`);
  if (address[address.length - 1]) {
    parent.left = value;
  } else {
    parent.right = value;
  }
  return result;
}
export type Binding = {
  name: string;
  address: Address;
  value: Sexpr;
};
// returns null if the template doesn't fit
function generateBindings(molecule: Sexpr, template: Sexpr, address: Address = []): Binding[] | null {
  if (template.type === "atom") {
    if (template.value[0] === "@") {
      return [{ name: template.value, address: address, value: structuredClone(molecule) }];
    } else if (molecule.type === "atom" && molecule.value === template.value) {
      return [];
    } else {
      return null;
    }
  } else {
    if (molecule.type === "atom") {
      return null;
    } else {
      const left_match = generateBindings(molecule.left, template.left, [...address, true]);
      const right_match = generateBindings(molecule.right, template.right, [...address, false]);
      if (left_match === null || right_match === null) {
        return null;
      } else {
        return left_match.concat(right_match);
      }
    }
  }
}
export function findBindingTargets(template: Sexpr, binding: Binding, cur_address: Address): Address[] {
  if (template.type === "atom") {
    if (template.value[0] === "@" && binding.name === template.value) {
      return [cur_address];
    } else {
      return [];
    }
  } else {
    return [
      ...findBindingTargets(template.left, binding, [...cur_address, true]),
      ...findBindingTargets(template.right, binding, [...cur_address, false])
    ];
  }
}
function applyBindings(template: Sexpr, bindings: Binding[]): Sexpr {
  if (template.type === "atom") {
    if (template.value[0] === "@") {
      const matching_binding = bindings.find(({ name }) => name === template.value);
      if (matching_binding !== undefined) {
        return matching_binding.value;
      } else {
        return template;
      }
    } else {
      return template;
    }
  } else {
    return {
      type: "pair",
      left: applyBindings(template.left, bindings),
      right: applyBindings(template.right, bindings)
    };
  }
}
export function afterVau(molecule: Sexpr, vau: Pair): { new_molecule: Sexpr; bindings: Binding[]; } | null {
  const bindings = generateBindings(molecule, vau.left);
  if (bindings === null) return null;
  return { new_molecule: applyBindings(vau.right, bindings), bindings: bindings };
}
export function afterRecursiveVau(molecule: Sexpr, vau: Pair): { bound_at: Address; new_molecule: Sexpr; bindings: Binding[]; } | null {
  let addresses_to_try: Address[] = [[]];
  while (addresses_to_try.length > 0) {
    const cur_address = addresses_to_try.shift()!;
    const cur_molecule = getAtAddress(molecule, cur_address);
    const result = afterVau(cur_molecule, vau);
    if (result !== null) {
      return {
        bound_at: cur_address,
        new_molecule: setAtAddress(molecule, cur_address, result.new_molecule),
        bindings: result.bindings,
      };
    } else if (cur_molecule.type === "pair") {
      addresses_to_try.push([...cur_address, true]);
      addresses_to_try.push([...cur_address, false]);
    }
  }
  return null;
}
export function isValidAddress(molecule: Sexpr, address: Address): boolean {
  try {
    getAtAddress(molecule, address);
    return true;
  } catch (error) {
    return false;
  }
}
// let toolbar_vaus: {}
export function doList(values: Sexpr[]): Sexpr {
  let result = doAtom("nil") as Sexpr;
  reversedForEach(values, v => {
    result = doPair(v, result);
  });
  return result;
}
export function doPair(left: Sexpr, right: Sexpr): Pair {
  return { type: "pair", left, right };
}
export function doAtom(value: string): Atom {
  return { type: "atom", value };
}
export function containsTemplate(v: Sexpr): boolean {
  if (v.type === "atom") return v.value[0] === "@";
  return containsTemplate(v.left) || containsTemplate(v.right);
}
export function eqSexprs(a: Sexpr, b: Sexpr): boolean {
  if (a.type === "atom" && b.type === "atom") return a.value === b.value;
  if (a.type === "pair" && b.type === "pair") {
    return eqSexprs(a.left, b.left) && eqSexprs(a.right, b.right);
  }
  return false;
}
export function isValidVau(vau: Pair): boolean {
  function getAllTemplateNames(v: Sexpr): string[] {
    if (v.type === "atom") {
      if (v.value[0] === "@") {
        return [v.value];
      } else {
        return [];
      }
    } else {
      return [...getAllTemplateNames(v.left), ...getAllTemplateNames(v.right)];
    }
  }
  let source_templates = getAllTemplateNames(vau.left);
  // no repeated templates
  if (new Set(source_templates).size < source_templates.length) return false;
  // no orphan templates
  if (getAllTemplateNames(vau.right).some(x => !source_templates.includes(x))) return false;
  return true;
}
