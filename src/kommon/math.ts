export function randomFloat(low_inclusive: number, high_exclusive: number): number {
    return low_inclusive + Math.random() * (high_exclusive - low_inclusive);
}

export function randomInt(low_inclusive: number, high_exclusive: number): number {
    return low_inclusive + Math.floor(Math.random() * (high_exclusive - low_inclusive));
}

export function randomCentered(half_size: number): number {
    return (Math.random() * 2 - 1) * half_size;
}

/** random float between -.5 & .5 */
export function rand05(): number {
    return Math.random() - .5;
}


export function max(arr: number[]) {
    if (arr.length === 0) {
        return undefined
    }
    return arr[argmax(arr)!];
}

export function argmax(arr: number[]) {
    if (arr.length === 0) {
        return undefined
    }
    let res = 0;
    let biggest = arr[0];
    for (let k = 1; k < arr.length; k++) {
        if (arr[k] > biggest) {
            biggest = arr[k];
            res = k;
        }
    }
    return res;
}

export function lerp(a: number, b: number, t: number): number {
    return a * (1 - t) + b * t;
}

/** t === inverseLerp(a, b, lerp(a, b, t)) */
export function inverseLerp(a: number, b: number, value: number): number {
    if (a === b) return 0.5;
    let t = (value - a) / (b - a);
    return t;
}

export function towards(cur: number, target: number, max_delta: number): number {
    if (cur > target) {
        return Math.max(cur - max_delta, target);
    } else if (cur < target) {
        return Math.min(cur + max_delta, target);
    } else {
        return target;
    }
}

export function mod(n: number, m: number) {
    return ((n % m) + m) % m;
}

export function wrap(value: number, low: number, high: number) {
    return mod(value - low, high - low) + low;
}

export function remap(value: number, old_a: number, old_b: number, new_a: number, new_b: number) {
    let t = (value - old_a) / (old_b - old_a);
    return t * (new_b - new_a) + new_a;
}

export function smoothstep(toZero: number, toOne: number, value: number) {
    let x = Math.max(0, Math.min(1, (value - toZero) / (toOne - toZero)));
    return x * x * (3 - 2 * x);
}

export function clamp(value: number, min_inclusive: number, max_inclusive: number): number {
    return Math.max(min_inclusive, Math.min(max_inclusive, value));
}

export function inRange(value: number, min_inclusive: number, max_exclusive: number): boolean {
    return value >= min_inclusive && value < max_exclusive;
}

export function onBorder(value: number, min_inclusive: number, max_exclusive: number): boolean {
    return value == min_inclusive || (value + 1) === max_exclusive;
}

// from https://stackoverflow.com/questions/2450954/how-to-randomize-shuffle-a-javascript-array
export function shuffle<T>(array: T[]) {
    let currentIndex = array.length, randomIndex;
    // While there remain elements to shuffle.
    while (currentIndex != 0) {
        // Pick a remaining element.
        randomIndex = Math.floor(Math.random() * currentIndex);
        currentIndex--;
        // And swap it with the current element.
        [array[currentIndex], array[randomIndex]] = [
            array[randomIndex], array[currentIndex]];
    }
    return array;
}

export function randomChoice<T>(arr: T[]) {
    if (arr.length === 0) {
        throw new Error("can't choose out of an empty array");
    }
    return arr[Math.floor(Math.random() * arr.length)];
}

// Use objects instead of arrays: https://jsben.ch/FgKVi
export class Vec4 {
    constructor(
        public x: number = 0.0,
        public y: number = 0.0,
        public z: number = 0.0,
        public w: number = 0.0,
    ) { }

    static scale(v: Vec4, s: number, out?: Vec4): Vec4 {
        out = out || new Vec4();
        out.x = v.x * s;
        out.y = v.y * s;
        out.z = v.z * s;
        out.w = v.w * s;
        return out;
    }

    static zero = new Vec4(0, 0, 0, 0);
    static one = new Vec4(1, 1, 1, 1);

    toArray(): [number, number, number, number] {
        return [this.x, this.y, this.z, this.w];
    }
}

type CardinalDirection = "xpos" | "xneg" | "ypos" | "yneg";

export class Vec2 {
    constructor(
        public readonly x: number = 0.0,
        public readonly y: number = 0.0,
    ) { }

    toString(): string {
        return `Vec2(${this.x}, ${this.y})`;
    }

    static readonly zero = new Vec2(0, 0);
    static readonly one = new Vec2(1, 1);
    static readonly half = new Vec2(.5, .5);

    static both(v: number): Vec2 {
        return new Vec2(v, v);
    }

    angleTo(other: Vec2): number {
        return Math.atan2(other.y - this.y, other.x - this.x);
    }

    subX(x: number): Vec2 {
        return new Vec2(this.x - x, this.y);
    }

    subY(y: number): Vec2 {
        return new Vec2(this.x, this.y - y);
    }

    addX(x: number): Vec2 {
        return new Vec2(this.x + x, this.y);
    }

    addY(y: number): Vec2 {
        return new Vec2(this.x, this.y + y);
    }

    addXY(x: number, y: number): Vec2 {
        return new Vec2(this.x + x, this.y + y);
    }

    add(other: Vec2): Vec2 {
        return new Vec2(
            this.x + other.x,
            this.y + other.y,
        );
    }

    sub(other: Vec2): Vec2 {
        return new Vec2(
            this.x - other.x,
            this.y - other.y,
        );
    }

    mul(other: Vec2): Vec2 {
        return new Vec2(
            this.x * other.x,
            this.y * other.y,
        );
    }

    div(other: Vec2): Vec2 {
        return new Vec2(
            this.x / other.x,
            this.y / other.y,
        );
    }


    mulXY(x: number, y: number): Vec2 {
        return new Vec2(
            this.x * x,
            this.y * y,
        );
    }

    scale(factor: number): Vec2 {
        return new Vec2(
            this.x * factor,
            this.y * factor,
        );
    }

    equals(other: Vec2): boolean {
        return this.x === other.x && this.y === other.y;
    }

    angle() {
        return Math.atan2(this.y, this.x);
    }

    map1(fn: (v: number) => number): Vec2 {
        return new Vec2(
            fn(this.x),
            fn(this.y),
        );
    }

    magSq(): number {
        return this.x * this.x + this.y * this.y;
    }

    mag(): number {
        return Math.sqrt(this.magSq());
    }

    radians(): number {
        return Vec2.radians(this);
    }

    rotate(radians: number): Vec2 {
        return new Vec2(
            Math.cos(radians) * this.x - Math.sin(radians) * this.y,
            Math.sin(radians) * this.x + Math.cos(radians) * this.y,
        )
    }

    static findTransformationWithFixedOrigin({ source, target }: { source: Vec2, target: Vec2 }): (v: Vec2) => Vec2 {
        let scaling_factor = target.mag() / source.mag();
        let delta_radians = target.radians() - source.radians();
        return (v: Vec2) => v.rotate(delta_radians).scale(scaling_factor);
    }

    static inBounds(point: Vec2, bounds: Vec2): boolean {
        return inRange(point.x, 0, bounds.x) && inRange(point.y, 0, bounds.y);
    }

    static lerp(a: Vec2, b: Vec2, t: number): Vec2 {
        return new Vec2(
            a.x * (1 - t) + b.x * t,
            a.y * (1 - t) + b.y * t,
        );
    }

    static add(a: Vec2, b: Vec2): Vec2 {
        return a.add(b);
    }

    static sub(a: Vec2, b: Vec2): Vec2 {
        return a.sub(b);
    }

    static scale(v: Vec2, s: number): Vec2 {
        return v.scale(s);
    }

    static mag(v: Vec2): number {
        return Math.sqrt(v.magSq());
    }

    static radians(v: Vec2): number {
        return Math.atan2(v.y, v.x);
    }
}

// todo: generalize, error check for too many args
export class Rectangle {
    constructor(
        public topLeft: Vec2,
        public size: Vec2) { }

    contains(point: Vec2): boolean {
        return Vec2.inBounds(point.sub(this.topLeft), this.size);
    }

    getCenter(): Vec2 {
        return this.topLeft.add(this.size.scale(.5));
    }


    public get left(): number {
        return this.topLeft.x;
    }

    public get right(): number {
        return this.topLeft.x + this.size.x;
    }

    public get bottomRight(): Vec2 {
        return this.topLeft.add(this.size);
    }

    resized(new_size: Vec2, fixed: "center"): Rectangle {
        return Rectangle.fromParams({ center: this.getCenter(), size: new_size });
    }

    static readonly unit = new Rectangle(Vec2.zero, Vec2.one);

    static fromParams(params: {
        topLeft?: Vec2,
        center?: Vec2,
        bottomRight?: Vec2,
        bottomLeft?: Vec2,
        size?: Vec2,
        topRight?: Vec2,
    }): Rectangle {
        // let size = new Vec2();
        // let topLeft = new Vec2();

        if (params.topLeft !== undefined) {
            let topLeft = params.topLeft;
            if (params.size !== undefined) {
                return new Rectangle(topLeft, params.size);
            } else if (params.bottomRight !== undefined) {
                return new Rectangle(topLeft, params.bottomRight.sub(topLeft));
            } else if (params.center !== undefined) {
                return new Rectangle(topLeft, params.center.sub(topLeft).scale(2));
            } else {
                throw new Error("not enough data to compute rect");
            }
        } else if (params.center !== undefined) {
            let size: Vec2;
            if (params.size !== undefined) {
                size = params.size;
            } else if (params.bottomRight !== undefined) {
                size = params.bottomRight.sub(params.center).scale(2);
            } else {
                throw new Error("not enough data to compute rect");
            }
            let topLeft = params.center.sub(size.scale(.5));
            return new Rectangle(topLeft, size);
        } else if (params.bottomLeft !== undefined) {
            if (params.size !== undefined) {
                return new Rectangle(params.bottomLeft.subY(params.size.y), params.size);
            } else {
                throw new Error("unimplemented");
            }
        } else if (params.topRight !== undefined) {
            if (params.size !== undefined) {
                return new Rectangle(params.topRight.subX(params.size.x), params.size);
            } else {
                throw new Error("unimplemented");
            }
        } else if (params.bottomRight !== undefined) {
            if (params.size !== undefined) {
                return new Rectangle(params.bottomRight.sub(params.size), params.size);
            } else {
                throw new Error("unimplemented");
            }
        } else {
            throw new Error("unimplemented");
        }
    }
}
