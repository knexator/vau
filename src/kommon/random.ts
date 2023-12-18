import Rand from 'rand-seed';

export function randomInt(rand: Rand, low_inclusive: number, high_exclusive: number): number {
  return low_inclusive + Math.floor(rand.next() * (high_exclusive - low_inclusive));
}
// from https://stackoverflow.com/questions/2450954/how-to-randomize-shuffle-a-javascript-array
export function shuffle<T>(rand: Rand, array: T[]): T[] {
  let currentIndex = array.length, randomIndex;
  // While there remain elements to shuffle.
  while (currentIndex != 0) {
    // Pick a remaining element.
    randomIndex = Math.floor(rand.next() * currentIndex);
    currentIndex--;
    // And swap it with the current element.
    [array[currentIndex], array[randomIndex]] = [
      array[randomIndex], array[currentIndex]
    ];
  }
  return array;
}
export function randomChoiceWithoutRepeat<T>(rand: Rand, arr: T[], count: number) {
  if (count > arr.length) {
    throw new Error("array too small or count too big");
  }
  let result: T[] = [];
  while (result.length < count) {
    let cur = randomChoice(rand, arr);
    if (!result.includes(cur)) {
      result.push(cur);
    }
  }
  return result;
}
export function randomChoice<T>(rand: Rand, arr: T[]) {
  if (arr.length === 0) {
    throw new Error("can't choose out of an empty array");
  }
  return arr[Math.floor(rand.next() * arr.length)];
}
