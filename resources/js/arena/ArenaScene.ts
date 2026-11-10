import { Camera } from '@babylonjs/core/Cameras/camera';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import '@babylonjs/core/Culling/ray'; // required for pointer picking
import { Engine } from '@babylonjs/core/Engines/engine';
import { PointerEventTypes } from '@babylonjs/core/Events/pointerEvents';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateDisc } from '@babylonjs/core/Meshes/Builders/discBuilder';
import { CreatePolyhedron } from '@babylonjs/core/Meshes/Builders/polyhedronBuilder';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import '@babylonjs/core/Meshes/instancedMesh'; // enables Mesh.createInstance
import type { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Scene } from '@babylonjs/core/scene';
import type { BoxId } from '../types/api';
import {
    ArenaUnavailableError,
    BOX_LAYOUT,
    MAX_COINS,
    OUTCOME_COLOR,
    QUALITY,
    Spring,
    boxIdFromMetadata,
    coinsForLevel,
    easeInOutCubic,
    hardwareScalingLevel,
    isTap,
    type BoxLayout,
    type Outcome,
    type QualityProfile,
} from './logic';

export { ArenaUnavailableError, type Outcome, type QualityProfile };

export interface ArenaOptions {
    canvas: HTMLCanvasElement;
    quality?: QualityProfile;
    reducedMotion?: boolean;
    /** Called once per round when a chest is tapped. The arena then locks until resetRound(). */
    onBoxSelected: (boxId: BoxId) => void;
    /** Called when the browser drops the WebGL context. The caller falls back to 2D. */
    onContextLost?: () => void;
}

// Chest dimensions (world units).
const W = 2.0;
const D = 1.5;
const H = 1.0;

const LID_OPEN_ANGLE = 1.75;
/** Orientation of the half-cylinder lid so its curved side faces up. */
const LID_ARC_ROTATION_X = Math.PI / 2;

const STACK_X = 4.75;
const STACK_Z = 0.9;
/** Counter-tilt: the stack sits at the edge of a wide camera view, which makes it lean outward. */
const STACK_TILT = 0.12;
const PEDESTAL_H = 0.14;
const COIN_H = 0.15;
const coinY = (index: number) => PEDESTAL_H + COIN_H / 2 + index * COIN_H;

interface ChestView {
    id: BoxId;
    tier: 0 | 1 | 2;
    tint: Color3;
    phase: number;
    root: TransformNode;
    hinge: TransformNode;
    wood: StandardMaterial;
    gold: StandardMaterial;
    gem: StandardMaterial;
    woodBase: Color3;
    goldBase: Color3;
    ringMat: StandardMaterial;
    beam: Mesh;
    beamMat: StandardMaterial;
    glowDisc: Mesh;
    glowDiscMat: StandardMaterial;
    lift: Spring;
    squash: Spring;
    stretch: Spring;
    lid: Spring;
    tilt: Spring;
    dim: Spring;
    ringA: Spring;
    beamK: Spring;
    glow: Spring;
}

interface Particle {
    mesh: InstancedMesh;
    alive: boolean;
    life: number;
    max: number;
    size: number;
    spin: number;
    gravity: number;
    vx: number;
    vy: number;
    vz: number;
}

interface StackCoin {
    solid: InstancedMesh;
    scale: Spring;
    placed: boolean;
}

interface Flyer {
    mesh: InstancedMesh;
    active: boolean;
    delay: number;
    t: number;
    duration: number;
    from: Vector3;
    to: Vector3;
    coin: number;
}

const rand = () => Math.random();

/**
 * 3D stage: three cartoon treasure chests, a fixed camera, a coin-stack score meter and a
 * handful of sparkles, all built from primitives. Presentation only: it never fetches
 * questions, judges answers or talks to the server. It reports which chest the player tapped
 * and acts out outcomes that the caller has already confirmed with the server.
 *
 * All Babylon objects live in this class, outside React state.
 */
export class ArenaScene {
    private readonly engine: Engine;
    private readonly scene: Scene;
    private readonly views = new Map<BoxId, ChestView>();
    private readonly stageMaterial: StandardMaterial;
    private readonly plankMat: StandardMaterial;
    private readonly darkMat: StandardMaterial;
    private readonly resizeObserver: ResizeObserver | null;
    private readonly cleanups: Array<() => void> = [];

    private readonly sparkles: Particle[] = [];
    private readonly spillCoins: Particle[] = [];
    private readonly flyers: Flyer[] = [];
    private readonly stack: StackCoin[] = [];
    private stackRoot!: TransformNode;
    private readonly wobble = new Spring(0, 180, 7);

    private reducedMotion: boolean;
    private quality: QualityProfile;
    private selected: BoxId | null = null;
    private hovered: BoxId | null = null;
    private locked = false;
    private inputEnabled = true;
    private disposed = false;
    private time = 0;
    private flash = 0;
    private flashColor = new Color3(0, 0, 0);
    private coinCount = 0;

    private constructor(private readonly options: ArenaOptions) {
        this.quality = options.quality ?? 'medium';
        this.reducedMotion = options.reducedMotion ?? false;

        const { canvas } = options;

        this.engine = new Engine(
            canvas,
            QUALITY[this.quality].antialias,
            { alpha: false, stencil: false, powerPreference: 'high-performance', preserveDrawingBuffer: false },
            false,
        );
        this.applyPixelRatio();

        this.scene = new Scene(this.engine);
        this.scene.clearColor = new Color4(0.043, 0.063, 0.125, 1);

        this.plankMat = this.solid('plank-material', new Color3(0.36, 0.19, 0.08));
        this.darkMat = this.solid('dark-material', new Color3(0.06, 0.04, 0.03));

        this.buildCameraAndLights();
        this.stageMaterial = this.buildStage();
        BOX_LAYOUT.forEach((layout, index) => this.buildChest(layout, index));
        this.buildStack();
        this.buildParticles();
        this.bindInput();

        this.scene.onBeforeRenderObservable.add(() => this.step(Math.min(0.05, this.engine.getDeltaTime() / 1000)));

        this.engine.onContextLostObservable.add(() => {
            this.stopLoop();
            options.onContextLost?.();
        });

        this.startLoop();

        const parent = canvas.parentElement;
        this.resizeObserver = typeof ResizeObserver !== 'undefined' && parent ? new ResizeObserver(() => this.engine.resize()) : null;
        this.resizeObserver?.observe(parent ?? canvas);

        const onVisibility = () => (document.hidden ? this.stopLoop() : this.startLoop());
        document.addEventListener('visibilitychange', onVisibility);
        this.cleanups.push(() => document.removeEventListener('visibilitychange', onVisibility));
    }

    /** Throws ArenaUnavailableError when WebGL cannot be created so the caller can show a fallback. */
    static create(options: ArenaOptions): ArenaScene {
        if (!Engine.isSupported()) {
            throw new ArenaUnavailableError();
        }

        try {
            return new ArenaScene(options);
        } catch (error) {
            throw new ArenaUnavailableError(error instanceof Error ? error.message : undefined);
        }
    }

    // ---- Public API ---------------------------------------------------------

    /** Mark a chest as the chosen one (or clear with null). Cosmetic: it squashes, springs up and glows. */
    highlightBox(boxId: BoxId | null): void {
        this.selected = boxId;

        const view = boxId ? this.views.get(boxId) : undefined;

        if (view && !this.reducedMotion) {
            view.squash.value = 0.72; // anticipation squash, then it springs up past 1 and settles
            view.squash.velocity = 0;
            this.emitSparkles(view.root.position.x, H + 0.9, 0, 6, 2);
        }
    }

    /**
     * Lock the choice to this chest without waiting for a tap (for the 2D mirror buttons).
     * Returns false when a choice was already made this round.
     */
    lockSelection(boxId: BoxId): boolean {
        if (this.locked) return false;

        this.locked = true;
        this.highlightBox(boxId);

        return true;
    }

    /** Swing the lid open and burst out light, sparkles and coins. Called only after the server issued the question. */
    revealBox(boxId: BoxId): void {
        const view = this.views.get(boxId);

        if (!view) return;

        this.selected ??= boxId;
        view.lid.target = LID_OPEN_ANGLE;
        view.beamK.target = 1;

        if (!this.reducedMotion) {
            const x = view.root.position.x;
            this.emitSparkles(x, H + 0.8, 0, 16, 3.2);
            this.emitCoins(x, H + 0.6, -0.3, 4);
        }
    }

    /** Close everything and accept a new tap. The coin stack is kept. */
    resetRound(): void {
        for (const view of this.views.values()) {
            view.lid.target = 0;
            view.beamK.target = 0;
        }

        this.selected = null;
        this.hovered = null;
        this.locked = false;
        this.flash = 0;
    }

    /** Act out an outcome the server has already confirmed, and move the coin stack to the confirmed level. */
    showConfirmedOutcome(outcome: Outcome, towerLevel?: number): void {
        const [r, g, b] = OUTCOME_COLOR[outcome];
        this.flashColor = new Color3(r, g, b);
        this.flash = 1;

        const view = this.selected ? this.views.get(this.selected) : undefined;

        if (view && !this.reducedMotion) {
            const x = view.root.position.x;

            if (outcome === 'correct') {
                view.lift.kick(8); // happy hop
                this.emitSparkles(x, H + 1.0, 0, 18, 3.6);
            } else if (outcome === 'wrong') {
                view.tilt.kick(10); // head-shake
            } else {
                view.lid.target = 0; // lid slams shut
                view.lid.kick(-9);
                view.beamK.target = 0;
                view.squash.value = 0.82;
                view.squash.velocity = 0;
            }
        }

        if (towerLevel !== undefined) {
            this.setTowerLevel(towerLevel);
        }
    }

    /** Coin stack height as a 0..1 fraction of the maximum score. One coin is 100 points. */
    setTowerLevel(level: number): void {
        const next = coinsForLevel(level);
        const previous = this.coinCount;

        this.coinCount = next;

        if (next > previous) {
            const from = this.sourcePoint();

            for (let i = previous; i < next; i += 1) {
                const flyer = this.reducedMotion ? undefined : this.flyers.find((candidate) => !candidate.active);

                if (!flyer) {
                    this.placeCoin(i);
                    continue;
                }

                flyer.active = true;
                flyer.delay = (i - previous) * 0.11;
                flyer.t = 0;
                flyer.duration = 0.7;
                flyer.coin = i;
                flyer.from.copyFrom(from);
                flyer.to.set(STACK_X, coinY(i), STACK_Z);
                flyer.mesh.setEnabled(false);
            }
        } else if (next < previous) {
            for (const flyer of this.flyers) {
                if (flyer.active && flyer.coin >= next) {
                    flyer.active = false;
                    flyer.mesh.setEnabled(false);
                }
            }

            for (let i = next; i < previous; i += 1) {
                const coin = this.stack[i];

                if (coin) {
                    coin.placed = false;
                    coin.scale.target = 0;
                    coin.scale.snap();
                }
            }
        }
    }

    /** Lets the caller block taps while a request is in flight. */
    setInputEnabled(enabled: boolean): void {
        this.inputEnabled = enabled;
    }

    setQuality(quality: QualityProfile): void {
        this.quality = quality;
        this.applyPixelRatio();
    }

    setReducedMotion(reduced: boolean): void {
        this.reducedMotion = reduced;
    }

    get selectedBoxId(): BoxId | null {
        return this.selected;
    }

    get isLocked(): boolean {
        return this.locked;
    }

    get isDisposed(): boolean {
        return this.disposed;
    }

    /** Releases the render loop, listeners, GPU resources and the engine. Safe to call twice. */
    dispose(): void {
        if (this.disposed) return;

        this.disposed = true;
        this.stopLoop();
        this.resizeObserver?.disconnect();
        this.cleanups.forEach((cleanup) => cleanup());
        this.cleanups.length = 0;
        this.scene.dispose();
        this.engine.dispose();
    }

    // ---- Build --------------------------------------------------------------

    private solid(name: string, color: Color3): StandardMaterial {
        const material = new StandardMaterial(name, this.scene);
        material.diffuseColor = color;
        material.specularColor = new Color3(0.1, 0.1, 0.1);

        return material;
    }

    private startLoop(): void {
        if (this.disposed) return;

        this.engine.stopRenderLoop();
        this.engine.runRenderLoop(() => this.scene.render());
    }

    private stopLoop(): void {
        this.engine.stopRenderLoop();
    }

    private applyPixelRatio(): void {
        this.engine.setHardwareScalingLevel(hardwareScalingLevel(window.devicePixelRatio, this.quality));
        this.engine.resize();
    }

    private buildCameraAndLights(): void {
        const camera = new ArcRotateCamera('camera', -Math.PI / 2, 1.08, 11.5, new Vector3(0.5, 1.2, 1.0), this.scene);

        // Fixed camera: no controls attached. A fixed horizontal field of view keeps all three
        // chests and the coin stack in frame on a narrow portrait phone and a wide desktop window.
        camera.fovMode = Camera.FOVMODE_HORIZONTAL_FIXED;
        camera.fov = 1.02;
        camera.minZ = 0.5;
        camera.maxZ = 60;

        const hemi = new HemisphericLight('hemi', new Vector3(0, 1, -0.4), this.scene);
        hemi.intensity = 0.8;
        hemi.groundColor = new Color3(0.2, 0.18, 0.3);

        const sun = new DirectionalLight('sun', new Vector3(-0.4, -1, 0.5), this.scene);
        sun.intensity = 0.6;
    }

    private buildStage(): StandardMaterial {
        const material = new StandardMaterial('stage-material', this.scene);
        material.diffuseColor = new Color3(0.11, 0.14, 0.32);
        material.specularColor = Color3.Black();

        const stage = CreateCylinder('stage', { diameter: 16, height: 0.3, tessellation: 48 }, this.scene);
        stage.position.set(0, -0.15, 1.5);
        stage.material = material;
        stage.isPickable = false;

        return material;
    }

    private tag<T extends Mesh>(mesh: T, boxId: BoxId): T {
        mesh.metadata = { boxId };

        return mesh;
    }

    /** Merge parts that share a material into one mesh (fewer draw calls). Parts must be unparented. */
    private merge(name: string, parts: Mesh[], material: StandardMaterial): Mesh {
        parts.forEach((part) => {
            part.material = material;
        });

        const merged = Mesh.MergeMeshes(parts, true, true, undefined, false, false);

        if (!merged) {
            throw new Error(`Could not build ${name}`);
        }

        merged.name = name;
        merged.material = material;

        return merged;
    }

    private buildChest(layout: BoxLayout, index: number): void {
        const id = layout.id;
        const tint = new Color3(...layout.color);
        const tier = layout.difficulty === 'easy' ? 0 : layout.difficulty === 'medium' ? 1 : 2;
        const woodBase = new Color3(0.52, 0.3, 0.15);
        const goldBase = new Color3(1, 0.78, 0.12);

        const wood = this.solid(`${id}-wood`, woodBase.clone());
        const gold = this.solid(`${id}-gold`, goldBase.clone());
        gold.specularColor = new Color3(1, 0.9, 0.5);
        gold.specularPower = 48;
        const gem = this.solid(`${id}-gem`, tint.clone());
        gem.specularColor = new Color3(1, 1, 1);

        const root = new TransformNode(`${id}-root`, this.scene);
        root.position.set(layout.x, 0, 0);

        const hinge = new TransformNode(`${id}-hinge`, this.scene);
        hinge.parent = root;
        hinge.position.set(0, H, D / 2); // lid pivots on its back edge

        const box = (w: number, h: number, d: number, x: number, y: number, z: number) => {
            const mesh = CreateBox('part', { width: w, height: h, depth: d }, this.scene);
            mesh.position.set(x, y, z);

            return mesh;
        };
        const ball = (diameter: number, x: number, y: number, z: number) => {
            const mesh = CreateSphere('part', { diameter, segments: 6 }, this.scene);
            mesh.position.set(x, y, z);

            return mesh;
        };
        // Half-cylinder arch lying along the x axis, flat side down, curved side up.
        const arch = (length: number, diameter: number, x: number) => {
            const mesh = CreateCylinder(
                'part',
                { diameter, height: length, arc: 0.5, enclose: true, tessellation: 28, sideOrientation: Mesh.DOUBLESIDE },
                this.scene,
            );
            mesh.rotation.set(LID_ARC_ROTATION_X, 0, Math.PI / 2);
            mesh.position.set(x, 0, -D / 2);

            return mesh;
        };

        // Body: wooden box, dark plank lines, gold bands, corner posts, lock and studs.
        const bodyWood = this.merge(`${id}-body`, [box(W, H, D, 0, H / 2, 0)], wood);
        bodyWood.parent = root;

        const planks = this.merge(
            `${id}-planks`,
            [box(W - 0.1, 0.035, 0.03, 0, 0.34, -D / 2 - 0.004), box(W - 0.1, 0.035, 0.03, 0, 0.68, -D / 2 - 0.004)],
            this.plankMat,
        );
        planks.parent = root;

        const bodyGoldParts: Mesh[] = [
            box(0.24, H + 0.05, D + 0.05, -0.58, H / 2, 0),
            box(0.24, H + 0.05, D + 0.05, 0.58, H / 2, 0),
            box(0.15, H + 0.04, 0.15, -W / 2, H / 2, -D / 2),
            box(0.15, H + 0.04, 0.15, W / 2, H / 2, -D / 2),
            box(0.15, H + 0.04, 0.15, -W / 2, H / 2, D / 2),
            box(0.15, H + 0.04, 0.15, W / 2, H / 2, D / 2),
            box(0.46, 0.54, 0.14, 0, H - 0.2, -D / 2 - 0.06), // lock plate
            ball(0.15, -0.58, 0.22, -D / 2 - 0.03),
            ball(0.15, 0.58, 0.22, -D / 2 - 0.03),
            ball(0.15, -0.58, 0.76, -D / 2 - 0.03),
            ball(0.15, 0.58, 0.76, -D / 2 - 0.03),
        ];
        if (tier >= 1) {
            bodyGoldParts.push(box(W + 0.08, 0.1, D + 0.08, 0, 0.05, 0)); // gold base trim on higher tiers
        }
        const bodyGold = this.merge(`${id}-gold`, bodyGoldParts, gold);
        bodyGold.parent = root;

        const keyhole = this.merge(`${id}-keyhole`, [box(0.09, 0.2, 0.03, 0, H - 0.2, -D / 2 - 0.14)], this.darkMat);
        keyhole.parent = root;

        // Lid: arched wood with gold bands and a gem (or three on the top tier). Built around the hinge.
        const lidWood = this.merge(`${id}-lid`, [arch(W, D, 0)], wood);
        lidWood.parent = hinge;

        const lidGold = this.merge(`${id}-lid-gold`, [arch(0.24, D + 0.07, -0.58), arch(0.24, D + 0.07, 0.58)], gold);
        lidGold.parent = hinge;

        const gemPart = (size: number, x: number, y: number, z: number) => {
            const mesh = CreatePolyhedron('part', { type: 1, size }, this.scene);
            mesh.scaling.set(0.75, 1.05, 0.5);
            mesh.rotation.x = -0.6;
            mesh.position.set(x, y, z);

            return mesh;
        };
        const gems = [gemPart(0.34, 0, 0.46, -D * 0.93)];
        if (tier === 2) {
            gems.push(gemPart(0.22, -0.82, 0.4, -D * 0.9), gemPart(0.22, 0.82, 0.4, -D * 0.9));
        }
        const gemMesh = this.merge(`${id}-gems`, gems, gem);
        gemMesh.parent = hinge;

        // Invisible, generous hit area so small phone taps never miss.
        const hit = CreateBox(`${id}-hit`, { width: W + 0.8, height: 2.6, depth: D + 1.2 }, this.scene);
        hit.parent = root;
        hit.position.y = 1.2;
        hit.visibility = 0;

        for (const mesh of [bodyWood, planks, bodyGold, keyhole, lidWood, lidGold, gemMesh, hit]) {
            this.tag(mesh, id);
        }

        // Spotlight ring on the stage under each chest: a tap-me cue that brightens on hover and selection.
        const ringMat = new StandardMaterial(`${id}-ring-material`, this.scene);
        ringMat.disableLighting = true;
        ringMat.emissiveColor = tint;
        ringMat.alpha = 0.25;
        ringMat.backFaceCulling = false;
        ringMat.alphaMode = Engine.ALPHA_ADD;
        const ring = CreateDisc(`${id}-ring`, { radius: 1.6, tessellation: 40 }, this.scene);
        ring.rotation.x = Math.PI / 2;
        ring.position.y = 0.02;
        ring.parent = root;
        ring.material = ringMat;
        ring.isPickable = false;

        // Light shaft and glowing interior that appear when the lid opens.
        const beamMat = new StandardMaterial(`${id}-beam-material`, this.scene);
        beamMat.disableLighting = true;
        beamMat.emissiveColor = tint.add(new Color3(0.3, 0.3, 0.3)).clampToRef(0, 1, new Color3());
        beamMat.alpha = 0;
        beamMat.backFaceCulling = false;
        beamMat.alphaMode = Engine.ALPHA_ADD;
        const beam = CreateCylinder(`${id}-beam`, { diameterTop: 1.7, diameterBottom: 0.9, height: 2.4, tessellation: 20, hasRings: false, enclose: false }, this.scene);
        beam.parent = root;
        beam.position.y = H + 1.2;
        beam.material = beamMat;
        beam.isPickable = false;
        beam.setEnabled(false);

        const glowDiscMat = new StandardMaterial(`${id}-disc-material`, this.scene);
        glowDiscMat.disableLighting = true;
        glowDiscMat.emissiveColor = new Color3(1, 0.92, 0.55);
        glowDiscMat.alpha = 0;
        glowDiscMat.backFaceCulling = false;
        glowDiscMat.alphaMode = Engine.ALPHA_ADD;
        const glowDisc = CreateDisc(`${id}-disc`, { radius: 0.78, tessellation: 24 }, this.scene);
        glowDisc.rotation.x = Math.PI / 2;
        glowDisc.position.y = H + 0.03;
        glowDisc.parent = root;
        glowDisc.material = glowDiscMat;
        glowDisc.isPickable = false;
        glowDisc.setEnabled(false);

        this.views.set(id, {
            id,
            tier,
            tint,
            phase: index * 1.9,
            root,
            hinge,
            wood,
            gold,
            gem,
            woodBase,
            goldBase,
            ringMat,
            beam,
            beamMat,
            glowDisc,
            glowDiscMat,
            lift: new Spring(0, 170, 11),
            squash: new Spring(1, 260, 14),
            stretch: new Spring(1, 170, 12),
            lid: new Spring(0, 95, 9.5),
            tilt: new Spring(0, 120, 6),
            dim: new Spring(0, 70, 15),
            ringA: new Spring(0.25, 90, 14),
            beamK: new Spring(0, 60, 8),
            glow: new Spring(0, 80, 10),
        });
    }

    /** Gold coin stack that doubles as a progress meter: faint ghost coins show the room left to fill. */
    private buildStack(): void {
        this.stackRoot = new TransformNode('stack-root', this.scene);
        this.stackRoot.position.set(STACK_X, 0, STACK_Z);

        const pedestalMat = this.solid('pedestal-material', new Color3(0.28, 0.2, 0.08));
        const pedestal = CreateCylinder('pedestal', { diameter: 1.25, height: PEDESTAL_H, tessellation: 24 }, this.scene);
        pedestal.parent = this.stackRoot;
        pedestal.position.y = PEDESTAL_H / 2;
        pedestal.material = pedestalMat;
        pedestal.isPickable = false;

        const coinMat = this.solid('coin-material', new Color3(1, 0.78, 0.12));
        coinMat.specularColor = new Color3(1, 0.9, 0.5);
        coinMat.specularPower = 48;
        coinMat.emissiveColor = new Color3(0.28, 0.2, 0.02);

        // One translucent column marks the full height of the meter (many overlapping ghost coins smeared).
        const ghostMat = this.solid('coin-ghost-material', new Color3(0.4, 0.32, 0.1));
        ghostMat.emissiveColor = new Color3(0.12, 0.09, 0.02);
        ghostMat.alpha = 0.16;

        const solidTemplate = CreateCylinder('coin-template', { diameter: 0.95, height: COIN_H * 0.9, tessellation: 22 }, this.scene);
        solidTemplate.material = coinMat;
        solidTemplate.isVisible = false;
        solidTemplate.isPickable = false;

        const track = CreateCylinder('coin-track', { diameter: 1.0, height: MAX_COINS * COIN_H, tessellation: 24 }, this.scene);
        track.parent = this.stackRoot;
        track.position.y = PEDESTAL_H + (MAX_COINS * COIN_H) / 2;
        track.material = ghostMat;
        track.isPickable = false;

        for (let i = 0; i < MAX_COINS; i += 1) {
            const offsetX = Math.sin(i * 1.7) * 0.04;
            const offsetZ = Math.cos(i * 2.3) * 0.04;

            const solid = solidTemplate.createInstance(`coin-${i}`);
            solid.parent = this.stackRoot;
            solid.position.set(offsetX, coinY(i), offsetZ);
            solid.rotation.y = i * 0.6;
            solid.scaling.setAll(0.0001);
            solid.isPickable = false;
            solid.setEnabled(false);

            this.stack.push({ solid, scale: new Spring(0, 320, 12), placed: false });
        }
    }

    private buildParticles(): void {
        const sparkleMat = new StandardMaterial('sparkle-material', this.scene);
        sparkleMat.disableLighting = true;
        sparkleMat.emissiveColor = new Color3(1, 0.93, 0.6);

        const sparkleTemplate = CreateSphere('sparkle-template', { diameter: 0.16, segments: 4 }, this.scene);
        sparkleTemplate.material = sparkleMat;
        sparkleTemplate.isVisible = false;
        sparkleTemplate.isPickable = false;

        for (let i = 0; i < QUALITY.medium.sparkles; i += 1) {
            this.sparkles.push(this.newParticle(sparkleTemplate.createInstance(`sparkle-${i}`), 5));
        }

        const smallCoinMat = this.solid('small-coin-material', new Color3(1, 0.78, 0.12));
        smallCoinMat.emissiveColor = new Color3(0.4, 0.28, 0.02);
        smallCoinMat.specularColor = new Color3(1, 0.9, 0.5);

        const smallCoinTemplate = CreateCylinder('small-coin-template', { diameter: 0.5, height: 0.08, tessellation: 16 }, this.scene);
        smallCoinTemplate.material = smallCoinMat;
        smallCoinTemplate.isVisible = false;
        smallCoinTemplate.isPickable = false;

        for (let i = 0; i < QUALITY.medium.spillCoins; i += 1) {
            this.spillCoins.push(this.newParticle(smallCoinTemplate.createInstance(`spill-${i}`), 12));
        }

        for (let i = 0; i < 8; i += 1) {
            const mesh = smallCoinTemplate.createInstance(`flyer-${i}`);
            mesh.isPickable = false;
            mesh.setEnabled(false);
            this.flyers.push({ mesh, active: false, delay: 0, t: 0, duration: 0.7, from: new Vector3(), to: new Vector3(), coin: 0 });
        }
    }

    private newParticle(mesh: InstancedMesh, gravity: number): Particle {
        mesh.isPickable = false;
        mesh.setEnabled(false);

        return { mesh, alive: false, life: 0, max: 1, size: 1, spin: 0, gravity, vx: 0, vy: 0, vz: 0 };
    }

    // ---- Effects ------------------------------------------------------------

    private emitSparkles(x: number, y: number, z: number, count: number, speed: number): void {
        if (this.reducedMotion) return;

        let room = QUALITY[this.quality].sparkles - this.sparkles.filter((p) => p.alive).length;

        for (const p of this.sparkles) {
            if (count <= 0 || room <= 0) break;
            if (p.alive) continue;

            const angle = rand() * Math.PI * 2;
            const spread = rand() * speed;

            p.alive = true;
            p.max = p.life = 0.7 + rand() * 0.6;
            p.size = 0.7 + rand() * 0.9;
            p.vx = Math.cos(angle) * spread;
            p.vz = Math.sin(angle) * spread * 0.5;
            p.vy = 2 + rand() * speed;
            p.spin = 0;
            p.mesh.position.set(x, y, z);
            p.mesh.setEnabled(true);
            count -= 1;
            room -= 1;
        }
    }

    private emitCoins(x: number, y: number, z: number, count: number): void {
        if (this.reducedMotion) return;

        let room = QUALITY[this.quality].spillCoins - this.spillCoins.filter((p) => p.alive).length;

        for (const p of this.spillCoins) {
            if (count <= 0 || room <= 0) break;
            if (p.alive) continue;

            p.alive = true;
            p.max = p.life = 1.2;
            p.size = 1;
            p.vx = (rand() - 0.5) * 3.2;
            p.vy = 4.5 + rand() * 2;
            p.vz = -0.6 - rand() * 1.4; // toward the camera
            p.spin = 6 + rand() * 6;
            p.mesh.position.set(x, y, z);
            p.mesh.rotation.set(rand() * 3, 0, rand() * 3);
            p.mesh.setEnabled(true);
            count -= 1;
            room -= 1;
        }
    }

    private sourcePoint(): Vector3 {
        const view = this.selected ? this.views.get(this.selected) : undefined;

        return new Vector3(view ? view.root.position.x : 0, H + 1.2, view ? -0.2 : 0);
    }

    private placeCoin(index: number): void {
        const coin = this.stack[index];

        if (!coin || index >= this.coinCount) return;

        coin.placed = true;
        coin.solid.setEnabled(true);
        coin.scale.target = 1;

        if (this.reducedMotion) {
            coin.scale.snap();
        } else {
            coin.scale.value = 0.2;
            coin.scale.velocity = 0;
            this.wobble.velocity = Math.min(9, this.wobble.velocity + 5);
            this.emitSparkles(STACK_X, coinY(index) + 0.2, STACK_Z, 2, 1.2);
        }
    }

    // ---- Input --------------------------------------------------------------

    /** Which chest (if any) is under the pointer right now. Uses an explicit pick, not Babylon's tap event. */
    private boxUnderPointer(): BoxId | null {
        const pick = this.scene.pick(this.scene.pointerX, this.scene.pointerY);

        return pick?.hit ? boxIdFromMetadata(pick.pickedMesh?.metadata) : null;
    }

    private bindInput(): void {
        const canvas = this.options.canvas;
        let down: { x: number; y: number } | null = null;

        const observer = this.scene.onPointerObservable.add((info) => {
            if (this.disposed) return;

            const event = info.event as PointerEvent;

            if (info.type === PointerEventTypes.POINTERMOVE) {
                const over = this.inputEnabled && !this.locked ? this.boxUnderPointer() : null;
                this.hovered = over;
                canvas.style.cursor = over ? 'pointer' : 'default';

                return;
            }

            if (info.type === PointerEventTypes.POINTERDOWN) {
                down = event.button === 0 || event.pointerType !== 'mouse' ? { x: event.clientX, y: event.clientY } : null;

                return;
            }

            if (info.type !== PointerEventTypes.POINTERUP) return;

            // Select on release, tolerating a slow press or a few pixels of drift (scrolling is not a tap).
            const start = down;
            down = null;

            if (!start || !isTap(start.x, start.y, event.clientX, event.clientY)) return;

            const boxId = this.boxUnderPointer();

            if (!boxId || !this.inputEnabled || this.locked) return;

            this.locked = true;
            this.highlightBox(boxId);
            this.options.onBoxSelected(boxId);
        });

        const onLeave = () => {
            this.hovered = null;
            canvas.style.cursor = '';
        };
        canvas.addEventListener('pointerleave', onLeave);

        this.cleanups.push(() => {
            this.scene.onPointerObservable.remove(observer);
            canvas.removeEventListener('pointerleave', onLeave);
            canvas.style.cursor = '';
        });
    }

    // ---- Per-frame update ---------------------------------------------------

    private step(dt: number): void {
        this.time += dt;
        const reduced = this.reducedMotion;
        const time = this.time;

        for (const view of this.views.values()) {
            const isSelected = this.selected === view.id;
            const isHovered = this.hovered === view.id && !this.locked && this.inputEnabled;
            const dimmed = this.locked && !isSelected;
            const idle = !isSelected && !dimmed;

            view.lift.target = isSelected ? 0.45 : isHovered ? 0.2 : dimmed ? -0.03 : 0;
            view.stretch.target = isSelected ? 1.1 : isHovered ? 1.07 : dimmed ? 0.9 : 1;
            view.dim.target = dimmed ? 1 : 0;
            view.glow.target = isSelected ? 1 : isHovered ? 0.5 : 0;
            view.ringA.target = isSelected ? 0.95 : isHovered ? 0.7 : dimmed ? 0.04 : 0.22 + (reduced ? 0 : 0.1 * (0.5 + 0.5 * Math.sin(time * 2.4 + view.phase)));

            const springs = [view.lift, view.squash, view.stretch, view.lid, view.tilt, view.dim, view.ringA, view.beamK, view.glow];
            springs.forEach((spring) => (reduced ? spring.snap() : spring.step(dt)));

            // A closing lid must not sink into the body: bounce off it instead.
            if (view.lid.value < 0) {
                view.lid.value = 0;
                view.lid.velocity = Math.abs(view.lid.velocity) * 0.35;
            }

            const sway = reduced || !idle ? 0 : Math.sin(time * 1.5 + view.phase) * 0.035;
            const bob = reduced ? 0 : Math.sin(time * 2 + view.phase) * (idle ? 0.05 : 0.02);
            const pulse = reduced || this.locked || !this.inputEnabled ? 1 : 1 + 0.025 * Math.sin(time * 3.2 + view.phase);
            const stretch = view.stretch.value;
            const squash = view.squash.value;

            view.root.position.y = Math.max(-0.1, view.lift.value + bob);
            view.root.scaling.set(stretch * (1 + (1 - squash) * 0.6) * pulse, squash * stretch, stretch * (1 + (1 - squash) * 0.6) * pulse);
            view.root.rotation.z = sway + view.tilt.value * 0.12;
            view.hinge.rotation.x = view.lid.value;

            // Materials: dim the chests that were not chosen, shine on the gold, pulse the gems.
            const f = 1 - 0.55 * Math.min(1, Math.max(0, view.dim.value));
            view.wood.diffuseColor.copyFromFloats(view.woodBase.r * f, view.woodBase.g * f, view.woodBase.b * f);
            view.gold.diffuseColor.copyFromFloats(view.goldBase.r * f, view.goldBase.g * f, view.goldBase.b * f);

            const shine = reduced ? 0 : Math.pow(Math.max(0, Math.sin(time * 2 - view.phase * 1.3)), 6);
            const goldGlow = (0.03 + 0.45 * shine + 0.3 * view.glow.value) * f;
            view.gold.emissiveColor.copyFromFloats(goldGlow, goldGlow * 0.8, goldGlow * 0.25);

            const gemPulse = reduced ? 0.5 : 0.5 + 0.5 * Math.sin(time * 3 + view.phase);
            const gemGlow = (0.5 + 0.3 * gemPulse + 0.7 * view.glow.value) * f;
            view.gem.emissiveColor.copyFromFloats(view.tint.r * gemGlow, view.tint.g * gemGlow, view.tint.b * gemGlow);

            view.ringMat.alpha = Math.min(1, Math.max(0, view.ringA.value)) * 0.8;

            const beamOn = view.beamK.value > 0.02;
            view.beam.setEnabled(beamOn);

            if (beamOn) {
                const k = Math.max(0.01, view.beamK.value);
                view.beam.scaling.set(k, k, k);
                view.beam.position.y = H + 1.2 * k;
                view.beam.rotation.y = reduced ? 0 : time * 0.8;
                view.beamMat.alpha = 0.2 * Math.min(1, k);
            }

            const openness = Math.min(1, Math.max(0, view.lid.value / LID_OPEN_ANGLE));
            view.glowDisc.setEnabled(openness > 0.1);
            view.glowDiscMat.alpha = 0.6 * openness;
        }

        // Particles.
        for (const group of [this.sparkles, this.spillCoins]) {
            for (const p of group) {
                if (!p.alive) continue;

                p.life -= dt;
                p.vy -= p.gravity * dt;
                p.mesh.position.x += p.vx * dt;
                p.mesh.position.y += p.vy * dt;
                p.mesh.position.z += p.vz * dt;

                if (p.spin) p.mesh.rotation.x += p.spin * dt;

                const fade = Math.min(1, Math.max(0, p.life / Math.max(0.01, p.max * 0.4)));
                p.mesh.scaling.setAll(Math.max(0.0001, p.size * fade));

                if (p.life <= 0 || (p.spin > 0 && p.mesh.position.y < 0.05 && p.vy < 0)) {
                    p.alive = false;
                    p.mesh.setEnabled(false);
                }
            }
        }

        // Coins flying from the chest to the stack.
        for (const flyer of this.flyers) {
            if (!flyer.active) continue;

            if (flyer.delay > 0) {
                flyer.delay -= dt;
                continue;
            }

            flyer.t += dt / flyer.duration;
            flyer.mesh.setEnabled(true);

            const k = easeInOutCubic(flyer.t);
            const arc = Math.sin(Math.PI * Math.min(1, flyer.t)) * 1.8;
            flyer.mesh.position.set(
                flyer.from.x + (flyer.to.x - flyer.from.x) * k,
                flyer.from.y + (flyer.to.y - flyer.from.y) * k + arc,
                flyer.from.z + (flyer.to.z - flyer.from.z) * k,
            );
            flyer.mesh.rotation.x += dt * 14;
            flyer.mesh.scaling.setAll(1 - 0.35 * k);

            if (flyer.t >= 1) {
                flyer.active = false;
                flyer.mesh.setEnabled(false);
                this.placeCoin(flyer.coin);
            }
        }

        // The stack: coins pop in with a bounce and the whole stack wobbles on its base.
        for (const coin of this.stack) {
            if (!coin.placed) continue;

            if (reduced) coin.scale.snap();
            else coin.scale.step(dt);

            coin.solid.scaling.setAll(Math.max(0.0001, coin.scale.value));
        }

        if (reduced) this.wobble.snap();
        else this.wobble.step(dt);
        this.stackRoot.rotation.z = STACK_TILT + this.wobble.value * 0.045;
        this.stackRoot.rotation.x = this.wobble.value * 0.03;

        // With reduced motion the outcome tint stays steady (no fade) until the next resetRound().
        this.flash = reduced ? this.flash : Math.max(0, this.flash - dt * 1.2);
        this.stageMaterial.emissiveColor.copyFromFloats(
            this.flashColor.r * 0.45 * this.flash,
            this.flashColor.g * 0.45 * this.flash,
            this.flashColor.b * 0.45 * this.flash,
        );
    }
}
