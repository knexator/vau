// Generated code -- CC0 -- No Rights Reserved -- http://www.redblobgames.com/grids/hexagons/

import { Vec2 as Point } from "./math";


// export class Point {
//     constructor(public readonly x: number, public readonly y: number) { }
// }

export class Hex {
    constructor(public readonly q: number, public readonly r: number, public readonly s: number) {
        if (Math.round(q + r + s) !== 0) throw "q + r + s must be 0";
    }

    public add(b: Hex): Hex {
        return new Hex(this.q + b.q, this.r + b.r, this.s + b.s);
    }


    public subtract(b: Hex): Hex {
        return new Hex(this.q - b.q, this.r - b.r, this.s - b.s);
    }


    public scale(k: number): Hex {
        return new Hex(this.q * k, this.r * k, this.s * k);
    }


    public rotateLeft(): Hex {
        return new Hex(-this.s, -this.q, -this.r);
    }


    public rotateRight(): Hex {
        return new Hex(-this.r, -this.s, -this.q);
    }

    public static directions: Hex[] = [new Hex(1, 0, -1), new Hex(1, -1, 0), new Hex(0, -1, 1), new Hex(-1, 0, 1), new Hex(-1, 1, 0), new Hex(0, 1, -1)];

    public static direction(direction: number): Hex {
        return Hex.directions[direction];
    }


    public neighbor(direction: number): Hex {
        return this.add(Hex.direction(direction));
    }

    public static diagonals: Hex[] = [new Hex(2, -1, -1), new Hex(1, -2, 1), new Hex(-1, -1, 2), new Hex(-2, 1, 1), new Hex(-1, 2, -1), new Hex(1, 1, -2)];

    public diagonalNeighbor(direction: number): Hex {
        return this.add(Hex.diagonals[direction]);
    }


    public len(): number {
        return (Math.abs(this.q) + Math.abs(this.r) + Math.abs(this.s)) / 2;
    }


    public distance(b: Hex): number {
        return this.subtract(b).len();
    }


    public equals(b: Hex): boolean {
        return this.distance(b) === 0;
    }


    public round(): Hex {
        let qi: number = Math.round(this.q);
        let ri: number = Math.round(this.r);
        let si: number = Math.round(this.s);
        let q_diff: number = Math.abs(qi - this.q);
        let r_diff: number = Math.abs(ri - this.r);
        let s_diff: number = Math.abs(si - this.s);
        if (q_diff > r_diff && q_diff > s_diff) {
            qi = -ri - si;
        }
        else
            if (r_diff > s_diff) {
                ri = -qi - si;
            }
            else {
                si = -qi - ri;
            }
        return new Hex(qi, ri, si);
    }


    public lerp(b: Hex, t: number): Hex {
        return new Hex(this.q * (1.0 - t) + b.q * t, this.r * (1.0 - t) + b.r * t, this.s * (1.0 - t) + b.s * t);
    }


    public linedraw(b: Hex): Hex[] {
        let N: number = this.distance(b);
        let a_nudge: Hex = new Hex(this.q + 1e-06, this.r + 1e-06, this.s - 2e-06);
        let b_nudge: Hex = new Hex(b.q + 1e-06, b.r + 1e-06, b.s - 2e-06);
        let results: Hex[] = [];
        let step: number = 1.0 / Math.max(N, 1);
        for (let i = 0; i <= N; i++) {
            results.push(a_nudge.lerp(b_nudge, step * i).round());
        }
        return results;
    }

    public toString(): string {
        return `${this.q}:${this.r}`;
    }

    static fromString(str: string): Hex {
        let [raw_q, raw_r] = str.split(":");
        let q = Number(raw_q);
        let r = Number(raw_r);
        return new Hex(q, r, -q - r);
    }
}

export class OffsetCoord {
    constructor(public col: number, public row: number) { }
    public static EVEN: number = 1;
    public static ODD: number = -1;

    public static qoffsetFromCube(offset: number, h: Hex): OffsetCoord {
        let col: number = h.q;
        let row: number = h.r + (h.q + offset * (h.q & 1)) / 2;
        if (offset !== OffsetCoord.EVEN && offset !== OffsetCoord.ODD) {
            throw "offset must be EVEN (+1) or ODD (-1)";
        }
        return new OffsetCoord(col, row);
    }


    public static qoffsetToCube(offset: number, h: OffsetCoord): Hex {
        let q: number = h.col;
        let r: number = h.row - (h.col + offset * (h.col & 1)) / 2;
        let s: number = -q - r;
        if (offset !== OffsetCoord.EVEN && offset !== OffsetCoord.ODD) {
            throw "offset must be EVEN (+1) or ODD (-1)";
        }
        return new Hex(q, r, s);
    }


    public static roffsetFromCube(offset: number, h: Hex): OffsetCoord {
        let col: number = h.q + (h.r + offset * (h.r & 1)) / 2;
        let row: number = h.r;
        if (offset !== OffsetCoord.EVEN && offset !== OffsetCoord.ODD) {
            throw "offset must be EVEN (+1) or ODD (-1)";
        }
        return new OffsetCoord(col, row);
    }


    public static roffsetToCube(offset: number, h: OffsetCoord): Hex {
        let q: number = h.col - (h.row + offset * (h.row & 1)) / 2;
        let r: number = h.row;
        let s: number = -q - r;
        if (offset !== OffsetCoord.EVEN && offset !== OffsetCoord.ODD) {
            throw "offset must be EVEN (+1) or ODD (-1)";
        }
        return new Hex(q, r, s);
    }

}

export class DoubledCoord {
    constructor(public col: number, public row: number) { }

    public static qdoubledFromCube(h: Hex): DoubledCoord {
        let col: number = h.q;
        let row: number = 2 * h.r + h.q;
        return new DoubledCoord(col, row);
    }


    public qdoubledToCube(): Hex {
        let q: number = this.col;
        let r: number = (this.row - this.col) / 2;
        let s: number = -q - r;
        return new Hex(q, r, s);
    }


    public static rdoubledFromCube(h: Hex): DoubledCoord {
        let col: number = 2 * h.q + h.r;
        let row: number = h.r;
        return new DoubledCoord(col, row);
    }


    public rdoubledToCube(): Hex {
        let q: number = (this.col - this.row) / 2;
        let r: number = this.row;
        let s: number = -q - r;
        return new Hex(q, r, s);
    }

}

export class Orientation {
    constructor(public f0: number, public f1: number, public f2: number, public f3: number, public b0: number, public b1: number, public b2: number, public b3: number, public start_angle: number) { }
}

export class Layout {
    constructor(public orientation: Orientation, public size: Point, public origin: Point) { }
    public static pointy: Orientation = new Orientation(Math.sqrt(3.0), Math.sqrt(3.0) / 2.0, 0.0, 3.0 / 2.0, Math.sqrt(3.0) / 3.0, -1.0 / 3.0, 0.0, 2.0 / 3.0, 0.5);
    public static flat: Orientation = new Orientation(3.0 / 2.0, 0.0, Math.sqrt(3.0) / 2.0, Math.sqrt(3.0), 2.0 / 3.0, 0.0, -1.0 / 3.0, Math.sqrt(3.0) / 3.0, 0.0);

    public static pointPixelOffset(h: Hex, size: number, origin: Point): Point {
        let M: Orientation = Layout.pointy;
        let x: number = (M.f0 * h.q + M.f1 * h.r) * size;
        let y: number = (M.f2 * h.q + M.f3 * h.r) * size;
        return new Point(x + origin.x, y + origin.y);
    }

    public hexToPixel(h: Hex): Point {
        let M: Orientation = this.orientation;
        let size: Point = this.size;
        let origin: Point = this.origin;
        let x: number = (M.f0 * h.q + M.f1 * h.r) * size.x;
        let y: number = (M.f2 * h.q + M.f3 * h.r) * size.y;
        return new Point(x + origin.x, y + origin.y);
    }


    public pixelToHex(p: Point): Hex {
        let M: Orientation = this.orientation;
        let size: Point = this.size;
        let origin: Point = this.origin;
        let pt: Point = new Point((p.x - origin.x) / size.x, (p.y - origin.y) / size.y);
        let q: number = M.b0 * pt.x + M.b1 * pt.y;
        let r: number = M.b2 * pt.x + M.b3 * pt.y;
        return new Hex(q, r, -q - r);
    }


    public hexCornerOffset(corner: number): Point {
        let M: Orientation = this.orientation;
        let size: Point = this.size;
        let angle: number = 2.0 * Math.PI * (M.start_angle - corner) / 6.0;
        return new Point(size.x * Math.cos(angle), size.y * Math.sin(angle));
    }


    public polygonCorners(h: Hex): Point[] {
        let corners: Point[] = [];
        let center: Point = this.hexToPixel(h);
        for (let i = 0; i < 6; i++) {
            let offset: Point = this.hexCornerOffset(i);
            corners.push(new Point(center.x + offset.x, center.y + offset.y));
        }
        return corners;
    }

}

export class HexMap<T> {
    private data: Map<string, T> = new Map();

    get(pos: Hex): T | undefined {
        return this.data.get(pos.toString());
    }

    /** returns the overwritten value, if any */
    set(pos: Hex, new_v: T) {
        this.data.set(pos.toString(), new_v);
    }

    forEach(callback: (pos: Hex, element: T) => void): void {
        for (const [k, v] of this.data.entries()) {
            callback(Hex.fromString(k), v);
        }
    }

    map<S>(callback: (pos: Hex, element: T) => S): HexMap<S> {
        let result = new HexMap<S>();
        for (const [k, v] of this.data.entries()) {
            let h = Hex.fromString(k);
            result.set(h, callback(h, v));
        }
        return result;
    }

    find(callback: (pos: Hex, element: T) => boolean): Hex | null {
        for (const [k, v] of this.data.entries()) {
            if (callback(Hex.fromString(k), v)) {
                return Hex.fromString(k);
            }
        }
        return null;
    }
}


class Tests {
    constructor() { }

    public static equalHex(name: string, a: Hex, b: Hex): void {
        if (!(a.q === b.q && a.s === b.s && a.r === b.r)) {
            complain(name);
        }
    }


    public static equalOffsetcoord(name: string, a: OffsetCoord, b: OffsetCoord): void {
        if (!(a.col === b.col && a.row === b.row)) {
            complain(name);
        }
    }


    public static equalDoubledcoord(name: string, a: DoubledCoord, b: DoubledCoord): void {
        if (!(a.col === b.col && a.row === b.row)) {
            complain(name);
        }
    }


    public static equalInt(name: string, a: number, b: number): void {
        if (!(a === b)) {
            complain(name);
        }
    }


    public static equalHexArray(name: string, a: Hex[], b: Hex[]): void {
        Tests.equalInt(name, a.length, b.length);
        for (let i = 0; i < a.length; i++) {
            Tests.equalHex(name, a[i], b[i]);
        }
    }


    public static testHexArithmetic(): void {
        Tests.equalHex("hex_add", new Hex(4, -10, 6), new Hex(1, -3, 2).add(new Hex(3, -7, 4)));
        Tests.equalHex("hex_subtract", new Hex(-2, 4, -2), new Hex(1, -3, 2).subtract(new Hex(3, -7, 4)));
    }


    public static testHexDirection(): void {
        Tests.equalHex("hex_direction", new Hex(0, -1, 1), Hex.direction(2));
    }


    public static testHexNeighbor(): void {
        Tests.equalHex("hex_neighbor", new Hex(1, -3, 2), new Hex(1, -2, 1).neighbor(2));
    }


    public static testHexDiagonal(): void {
        Tests.equalHex("hex_diagonal", new Hex(-1, -1, 2), new Hex(1, -2, 1).diagonalNeighbor(3));
    }


    public static testHexDistance(): void {
        Tests.equalInt("hex_distance", 7, new Hex(3, -7, 4).distance(new Hex(0, 0, 0)));
    }


    public static testHexRotateRight(): void {
        Tests.equalHex("hex_rotate_right", new Hex(1, -3, 2).rotateRight(), new Hex(3, -2, -1));
    }


    public static testHexRotateLeft(): void {
        Tests.equalHex("hex_rotate_left", new Hex(1, -3, 2).rotateLeft(), new Hex(-2, -1, 3));
    }


    public static testHexRound(): void {
        let a: Hex = new Hex(0.0, 0.0, 0.0);
        let b: Hex = new Hex(1.0, -1.0, 0.0);
        let c: Hex = new Hex(0.0, -1.0, 1.0);
        Tests.equalHex("hex_round 1", new Hex(5, -10, 5), new Hex(0.0, 0.0, 0.0).lerp(new Hex(10.0, -20.0, 10.0), 0.5).round());
        Tests.equalHex("hex_round 2", a.round(), a.lerp(b, 0.499).round());
        Tests.equalHex("hex_round 3", b.round(), a.lerp(b, 0.501).round());
        Tests.equalHex("hex_round 4", a.round(), new Hex(a.q * 0.4 + b.q * 0.3 + c.q * 0.3, a.r * 0.4 + b.r * 0.3 + c.r * 0.3, a.s * 0.4 + b.s * 0.3 + c.s * 0.3).round());
        Tests.equalHex("hex_round 5", c.round(), new Hex(a.q * 0.3 + b.q * 0.3 + c.q * 0.4, a.r * 0.3 + b.r * 0.3 + c.r * 0.4, a.s * 0.3 + b.s * 0.3 + c.s * 0.4).round());
    }


    public static testHexLinedraw(): void {
        Tests.equalHexArray("hex_linedraw", [new Hex(0, 0, 0), new Hex(0, -1, 1), new Hex(0, -2, 2), new Hex(1, -3, 2), new Hex(1, -4, 3), new Hex(1, -5, 4)], new Hex(0, 0, 0).linedraw(new Hex(1, -5, 4)));
    }


    public static testLayout(): void {
        let h: Hex = new Hex(3, 4, -7);
        let flat: Layout = new Layout(Layout.flat, new Point(10.0, 15.0), new Point(35.0, 71.0));
        Tests.equalHex("layout", h, flat.pixelToHex(flat.hexToPixel(h)).round());
        let pointy: Layout = new Layout(Layout.pointy, new Point(10.0, 15.0), new Point(35.0, 71.0));
        Tests.equalHex("layout", h, pointy.pixelToHex(pointy.hexToPixel(h)).round());
    }


    public static testOffsetRoundtrip(): void {
        let a: Hex = new Hex(3, 4, -7);
        let b: OffsetCoord = new OffsetCoord(1, -3);
        Tests.equalHex("conversion_roundtrip even-q", a, OffsetCoord.qoffsetToCube(OffsetCoord.EVEN, OffsetCoord.qoffsetFromCube(OffsetCoord.EVEN, a)));
        Tests.equalOffsetcoord("conversion_roundtrip even-q", b, OffsetCoord.qoffsetFromCube(OffsetCoord.EVEN, OffsetCoord.qoffsetToCube(OffsetCoord.EVEN, b)));
        Tests.equalHex("conversion_roundtrip odd-q", a, OffsetCoord.qoffsetToCube(OffsetCoord.ODD, OffsetCoord.qoffsetFromCube(OffsetCoord.ODD, a)));
        Tests.equalOffsetcoord("conversion_roundtrip odd-q", b, OffsetCoord.qoffsetFromCube(OffsetCoord.ODD, OffsetCoord.qoffsetToCube(OffsetCoord.ODD, b)));
        Tests.equalHex("conversion_roundtrip even-r", a, OffsetCoord.roffsetToCube(OffsetCoord.EVEN, OffsetCoord.roffsetFromCube(OffsetCoord.EVEN, a)));
        Tests.equalOffsetcoord("conversion_roundtrip even-r", b, OffsetCoord.roffsetFromCube(OffsetCoord.EVEN, OffsetCoord.roffsetToCube(OffsetCoord.EVEN, b)));
        Tests.equalHex("conversion_roundtrip odd-r", a, OffsetCoord.roffsetToCube(OffsetCoord.ODD, OffsetCoord.roffsetFromCube(OffsetCoord.ODD, a)));
        Tests.equalOffsetcoord("conversion_roundtrip odd-r", b, OffsetCoord.roffsetFromCube(OffsetCoord.ODD, OffsetCoord.roffsetToCube(OffsetCoord.ODD, b)));
    }


    public static testOffsetFromCube(): void {
        Tests.equalOffsetcoord("offset_from_cube even-q", new OffsetCoord(1, 3), OffsetCoord.qoffsetFromCube(OffsetCoord.EVEN, new Hex(1, 2, -3)));
        Tests.equalOffsetcoord("offset_from_cube odd-q", new OffsetCoord(1, 2), OffsetCoord.qoffsetFromCube(OffsetCoord.ODD, new Hex(1, 2, -3)));
    }


    public static testOffsetToCube(): void {
        Tests.equalHex("offset_to_cube even-", new Hex(1, 2, -3), OffsetCoord.qoffsetToCube(OffsetCoord.EVEN, new OffsetCoord(1, 3)));
        Tests.equalHex("offset_to_cube odd-q", new Hex(1, 2, -3), OffsetCoord.qoffsetToCube(OffsetCoord.ODD, new OffsetCoord(1, 2)));
    }


    public static testDoubledRoundtrip(): void {
        let a: Hex = new Hex(3, 4, -7);
        let b: DoubledCoord = new DoubledCoord(1, -3);
        Tests.equalHex("conversion_roundtrip doubled-q", a, DoubledCoord.qdoubledFromCube(a).qdoubledToCube());
        Tests.equalDoubledcoord("conversion_roundtrip doubled-q", b, DoubledCoord.qdoubledFromCube(b.qdoubledToCube()));
        Tests.equalHex("conversion_roundtrip doubled-r", a, DoubledCoord.rdoubledFromCube(a).rdoubledToCube());
        Tests.equalDoubledcoord("conversion_roundtrip doubled-r", b, DoubledCoord.rdoubledFromCube(b.rdoubledToCube()));
    }


    public static testDoubledFromCube(): void {
        Tests.equalDoubledcoord("doubled_from_cube doubled-q", new DoubledCoord(1, 5), DoubledCoord.qdoubledFromCube(new Hex(1, 2, -3)));
        Tests.equalDoubledcoord("doubled_from_cube doubled-r", new DoubledCoord(4, 2), DoubledCoord.rdoubledFromCube(new Hex(1, 2, -3)));
    }


    public static testDoubledToCube(): void {
        Tests.equalHex("doubled_to_cube doubled-q", new Hex(1, 2, -3), new DoubledCoord(1, 5).qdoubledToCube());
        Tests.equalHex("doubled_to_cube doubled-r", new Hex(1, 2, -3), new DoubledCoord(4, 2).rdoubledToCube());
    }


    public static testAll(): void {
        Tests.testHexArithmetic();
        Tests.testHexDirection();
        Tests.testHexNeighbor();
        Tests.testHexDiagonal();
        Tests.testHexDistance();
        Tests.testHexRotateRight();
        Tests.testHexRotateLeft();
        Tests.testHexRound();
        Tests.testHexLinedraw();
        Tests.testLayout();
        Tests.testOffsetRoundtrip();
        Tests.testOffsetFromCube();
        Tests.testOffsetToCube();
        Tests.testDoubledRoundtrip();
        Tests.testDoubledFromCube();
        Tests.testDoubledToCube();
    }

}



// Tests
function complain(name: string) { console.log("FAIL", name); }
Tests.testAll();

