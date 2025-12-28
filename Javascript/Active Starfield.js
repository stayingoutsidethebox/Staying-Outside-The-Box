// ✅ INJECTION PACK for your exact file:
// 1) Add the two bounce helper functions (paste right AFTER updateStarPhysics closes)
// 2) Inside the star loop add DID_BOUNCE
// 3) Replace your commented “PADDLE STAR PHYSICS” placeholder with the real paddle bounce block
// 4) Replace ONLY the bounce-ELSE block (not the wrap block) with helper-based normal bounce that respects DID_BOUNCE

/*==============================================================*
 *                    ACTIVE STARFIELD
 *==============================================================*/

// ...everything above unchanged...

/* DECIDE HOW EACH STAR SHOULD MOVE */
S.updateStarPhysics = function updateStarPhysics() {
  if (!S.starList.length) return;

  const NOW = S.getNowMs();
  const LAST = S.lastPhysicsMs || NOW;
  const dtMs = clampDtMs(NOW - LAST);
  S.lastPhysicsMs = NOW;

  const dtFrames = dtMs / SIXTY_FPS_FRAME_MS;
  if (dtFrames <= 0) return;

  const INFLUENCE_RANGE = S.screenPerimeter * 0.2;
  const INFLUENCE_RANGE_SQ = INFLUENCE_RANGE * INFLUENCE_RANGE;
  const WRAP_DISTANCE_SQ = 200 * 200;

  const SETTINGS = S.interactionSettings;
  const SCALE = S.screenScalePowers;

  const MOMENTUM_DECAY = decayPerFrameToDt(0.98, dtFrames);
  const WHITE_DECAY = decayPerFrameToDt(0.98, dtFrames);
  const POINTER_SPEED_DECAY = decayPerFrameToDt(0.5, dtFrames);
  const RING_DECAY = decayPerFrameToDt(0.95, dtFrames);
  const POKE_DECAY = decayPerFrameToDt(0.85, dtFrames);

  for (const STAR of S.starList) {
    // ✅ NEW: per-star-per-frame flag so paddle bounce can prevent normal bounce from stomping it
    let DID_BOUNCE = false;

    const POINTER_DELTA_X = S.pointerClientX - STAR.x;
    const POINTER_DELTA_Y = S.pointerClientY - STAR.y;

    const DISTANCE_SQ =
      POINTER_DELTA_X * POINTER_DELTA_X + POINTER_DELTA_Y * POINTER_DELTA_Y;

    if (DISTANCE_SQ < INFLUENCE_RANGE_SQ) {
      const DISTANCE = Math.sqrt(DISTANCE_SQ) + 0.0001;

      const UNIT_TO_POINTER_X = POINTER_DELTA_X / DISTANCE;
      const UNIT_TO_POINTER_Y = POINTER_DELTA_Y / DISTANCE;

      let ATTRACTION_GRADIENT =
        1 - (DISTANCE / (((SETTINGS.attractRadius * 5.2) * SCALE.attractionGradient) || 1));
      ATTRACTION_GRADIENT = Math.max(0, ATTRACTION_GRADIENT);

      const ATTRACTION_SHAPE = Math.pow(
        ATTRACTION_GRADIENT,
        Math.max(0.1, ((SETTINGS.attractScale * 0.48) * SCALE.attractionShape))
      );

      const ATTRACTION_FORCE =
        ((SETTINGS.attractStrength * 0.0044) * SCALE.attractionForce) *
        S.pointerSpeedUnits *
        ATTRACTION_SHAPE;

      let REPULSION_GRADIENT =
        1 - (DISTANCE / (((SETTINGS.repelRadius * 2.8) * SCALE.repulsionGradient) || 1));
      REPULSION_GRADIENT = Math.max(0, REPULSION_GRADIENT);

      const REPULSION_SHAPE = Math.pow(
        REPULSION_GRADIENT,
        Math.max(0.1, (SETTINGS.repelScale * 0.64))
      );

      const REPULSION_FORCE =
        ((SETTINGS.repelStrength * 0.0182) * SCALE.repulsionForce) *
        S.pointerSpeedUnits *
        REPULSION_SHAPE;

      const POKE_RADIUS = S.screenPerimeter * 0.2;
      const POKE_GRADIENT = 1 - (DISTANCE / POKE_RADIUS);
      const POKE_SHAPE = Math.pow(Math.max(0, POKE_GRADIENT), 2);

      const POKE_FORCE =
        (0.01 * SETTINGS.pokeStrength) *
        S.pokeImpulseTimer *
        POKE_SHAPE;

      STAR.momentumX += (ATTRACTION_FORCE * UNIT_TO_POINTER_X) * dtFrames;
      STAR.momentumY += (ATTRACTION_FORCE * UNIT_TO_POINTER_Y) * dtFrames;

      STAR.momentumX += (REPULSION_FORCE * -UNIT_TO_POINTER_X) * dtFrames;
      STAR.momentumY += (REPULSION_FORCE * -UNIT_TO_POINTER_Y) * dtFrames;

      STAR.momentumX += (POKE_FORCE * -UNIT_TO_POINTER_X) * dtFrames;
      STAR.momentumY += (POKE_FORCE * -UNIT_TO_POINTER_Y) * dtFrames;
    }

    const DRIFT_BOOST = Math.min(7, 0.01 * S.pointerSpeedUnits);

    STAR.momentumX += (STAR.vx * DRIFT_BOOST) * dtFrames;
    STAR.momentumY += (STAR.vy * DRIFT_BOOST) * dtFrames;

    STAR.momentumX *= window.KEYBOARD.multX;
    STAR.momentumY *= window.KEYBOARD.multY;
    STAR.momentumX += window.KEYBOARD.addX;
    STAR.momentumY += window.KEYBOARD.addY;

    const MOMENTUM_LIMIT = 2 * SETTINGS.clamp * SCALE.forceClamp;

    const MOMENTUM_MAG = Math.sqrt(
      STAR.momentumX * STAR.momentumX + STAR.momentumY * STAR.momentumY
    );

    if (MOMENTUM_MAG > MOMENTUM_LIMIT) {
      const MOMENTUM_SCALE = MOMENTUM_LIMIT / MOMENTUM_MAG;
      STAR.momentumX *= MOMENTUM_SCALE;
      STAR.momentumY *= MOMENTUM_SCALE;
    }

    STAR.x += (STAR.vx + STAR.momentumX) * dtFrames;
    STAR.y += (STAR.vy + STAR.momentumY) * dtFrames;

    STAR.momentumX *= MOMENTUM_DECAY;
    STAR.momentumY *= MOMENTUM_DECAY;

    /*==============================================================*
     *  PADDLE STAR PHYSICS (REPLACES your commented placeholder)
     *==============================================================*/
    if (window.KEYBOARD.paddlesTimer > 0 && STAR === S.starList[0]) {
      STAR.whiteValue = 1;
      STAR.opacity = 1;

      const CANVAS = S.constellationCanvas;
      if (CANVAS) {
        const rect = CANVAS.getBoundingClientRect();

        const viewLeft = -rect.left;
        const viewTop = -rect.top;
        const viewRight = viewLeft + window.innerWidth;
        const viewBottom = viewTop + window.innerHeight;

        // Paddle center (0..100 -> viewport -> canvas coords)
        const cx = viewLeft + (window.KEYBOARD.paddlesX / 100) * window.innerWidth;
        const cy = viewTop + (window.KEYBOARD.paddlesY / 100) * window.innerHeight;

        // Paddle spans (must match render)
        const paddleW = window.innerWidth * 0.10;
        const paddleH = window.innerHeight * 0.10;
        const halfPW = paddleW * 0.5;
        const halfPH = paddleH * 0.5;

        // Paddle thickness (match render feel)
        const paddleThickness = Math.max(2, Math.min(window.innerWidth, window.innerHeight) * 0.03);
        const halfT = paddleThickness * 0.5;

        // Ball radius
        const BALL_R = Math.max(2, (2 + STAR.size) || 2);

        // Current ball velocity (include momentum for “juice”)
        const Vx = (STAR.vx || 0) + (STAR.momentumX || 0);
        const Vy = (STAR.vy || 0) + (STAR.momentumY || 0);
        const speed = Math.sqrt(Vx * Vx + Vy * Vy);

        if (speed > 0.0001) {
          const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

          // Angle range: center hit = perpendicular, edge hit = shallow
          const maxAngle = 1.25; // ~72deg

          // Push-out distance so ball doesn't “stick” in the wall
          const pushOutX = BALL_R + halfT + 0.5;
          const pushOutY = BALL_R + halfT + 0.5;

          // Touch checks against viewport edges (with thickness + radius)
          const touchLeft   = STAR.x <= viewLeft   + (BALL_R + halfT);
          const touchRight  = STAR.x >= viewRight  - (BALL_R + halfT);
          const touchTop    = STAR.y <= viewTop    + (BALL_R + halfT);
          const touchBottom = STAR.y >= viewBottom - (BALL_R + halfT);

          // “Within paddle segment” checks
          const withinLeftRightPaddle = (STAR.y >= (cy - halfPH) && STAR.y <= (cy + halfPH));
          const withinTopBottomPaddle = (STAR.x >= (cx - halfPW) && STAR.x <= (cx + halfPW));

          const HIT_COOLDOWN_MS = 60;

          // LEFT paddle (bounce right)
          if (touchLeft && withinLeftRightPaddle && Vx < 0) {
            const offset = clamp((STAR.y - cy) / (halfPH || 1), -1, 1);
            const ang = offset * maxAngle;

            const outVx = +1 * speed * Math.cos(ang);
            const outVy = speed * Math.sin(ang);

            DID_BOUNCE =
              bounceVertical(STAR, viewLeft, +1, outVx, outVy, pushOutX, NOW, HIT_COOLDOWN_MS, true) || DID_BOUNCE;
          }
          // RIGHT paddle (bounce left)
          else if (touchRight && withinLeftRightPaddle && Vx > 0) {
            const offset = clamp((STAR.y - cy) / (halfPH || 1), -1, 1);
            const ang = offset * maxAngle;

            const outVx = -1 * speed * Math.cos(ang);
            const outVy = speed * Math.sin(ang);

            DID_BOUNCE =
              bounceVertical(STAR, viewRight, -1, outVx, outVy, pushOutX, NOW, HIT_COOLDOWN_MS, true) || DID_BOUNCE;
          }
          // TOP paddle (bounce down)
          else if (touchTop && withinTopBottomPaddle && Vy < 0) {
            const offset = clamp((STAR.x - cx) / (halfPW || 1), -1, 1);
            const ang = offset * maxAngle;

            const outVy = +1 * speed * Math.cos(ang);
            const outVx = speed * Math.sin(ang);

            DID_BOUNCE =
              bounceHorizontal(STAR, viewTop, +1, outVx, outVy, pushOutY, NOW, HIT_COOLDOWN_MS, true) || DID_BOUNCE;
          }
          // BOTTOM paddle (bounce up)
          else if (touchBottom && withinTopBottomPaddle && Vy > 0) {
            const offset = clamp((STAR.x - cx) / (halfPW || 1), -1, 1);
            const ang = offset * maxAngle;

            const outVy = -1 * speed * Math.cos(ang);
            const outVx = speed * Math.sin(ang);

            DID_BOUNCE =
              bounceHorizontal(STAR, viewBottom, -1, outVx, outVy, pushOutY, NOW, HIT_COOLDOWN_MS, true) || DID_BOUNCE;
          }
        }
      }
    }

    /* EDGE BEHAVIOR: WRAP VS BOUNCE */
    if (S.pointerRingTimer === 0 || DISTANCE_SQ > WRAP_DISTANCE_SQ || S.pokeImpulseTimer > 10) {
      const STAR_RADIUS = (STAR.whiteValue * 2 + STAR.size) || 0;

      if (STAR.x < -STAR_RADIUS) STAR.x = S.canvasWidth + STAR_RADIUS;
      else if (STAR.x > S.canvasWidth + STAR_RADIUS) STAR.x = -STAR_RADIUS;

      if (STAR.y < -STAR_RADIUS) STAR.y = S.canvasHeight + STAR_RADIUS;
      else if (STAR.y > S.canvasHeight + STAR_RADIUS) STAR.y = -STAR_RADIUS;
    } else {
      // ✅ REPLACED: helper-based bounce, respects DID_BOUNCE (so paddles don’t get overwritten)
      if (!DID_BOUNCE) {
        const STAR_RADIUS = (STAR.whiteValue * 2 + STAR.size) || 0;

        // Use combined velocity for bounce direction, but don’t nuke momentum for normal stars
        const Vx = (STAR.vx || 0) + (STAR.momentumX || 0);
        const Vy = (STAR.vy || 0) + (STAR.momentumY || 0);

        const pushOutX = STAR_RADIUS + 0.5;
        const pushOutY = STAR_RADIUS + 0.5;

        // Only clear momentum for the paddle ball while paddles are active
        const CLEAR = (STAR === S.starList[0] && window.KEYBOARD.paddlesTimer > 0);

        if (STAR.x < STAR_RADIUS) {
          const outVx = Math.abs(Vx);
          const outVy = Vy;
          DID_BOUNCE = bounceVertical(STAR, STAR_RADIUS, +1, outVx, outVy, pushOutX, NOW, 0, CLEAR) || DID_BOUNCE;
        } else if (STAR.x > S.canvasWidth - STAR_RADIUS) {
          const outVx = -Math.abs(Vx);
          const outVy = Vy;
          DID_BOUNCE = bounceVertical(STAR, S.canvasWidth - STAR_RADIUS, -1, outVx, outVy, pushOutX, NOW, 0, CLEAR) || DID_BOUNCE;
        }

        if (STAR.y < STAR_RADIUS) {
          const outVx = Vx;
          const outVy = Math.abs(Vy);
          DID_BOUNCE = bounceHorizontal(STAR, STAR_RADIUS, +1, outVx, outVy, pushOutY, NOW, 0, CLEAR) || DID_BOUNCE;
        } else if (STAR.y > S.canvasHeight - STAR_RADIUS) {
          const outVx = Vx;
          const outVy = -Math.abs(Vy);
          DID_BOUNCE = bounceHorizontal(STAR, S.canvasHeight - STAR_RADIUS, -1, outVx, outVy, pushOutY, NOW, 0, CLEAR) || DID_BOUNCE;
        }
      }
    }

    // ...rest of your decay/twinkle/etc unchanged...
    if (STAR.whiteValue > 0) {
      STAR.whiteValue *= WHITE_DECAY;
      if (STAR.whiteValue < 0.001) STAR.whiteValue = 0;
    }

    if (STAR.opacity <= 0.005) {
      STAR.opacity = 1;
      if (Math.random() < 0.07) STAR.whiteValue = 1;
    } else if (STAR.opacity > 0.02) {
      STAR.opacity -= (0.005 * STAR.fadeSpeed) * dtFrames;
    } else {
      STAR.opacity -= 0.0001 * dtFrames;
    }
  }

  // ...global decays unchanged...
  window.KEYBOARD.multX = 1;
  window.KEYBOARD.multY = 1;
  window.KEYBOARD.addX = 0;
  window.KEYBOARD.addY = 0;

  S.pointerSpeedUnits *= POINTER_SPEED_DECAY;
  if (S.pointerSpeedUnits < 0.001) S.pointerSpeedUnits = 0;

  S.pointerRingTimer *= RING_DECAY;
  if (S.pointerRingTimer < 1) S.pointerRingTimer = 0;

  S.pokeImpulseTimer *= POKE_DECAY;
  if (S.pokeImpulseTimer < 1) S.pokeImpulseTimer = 0;

  // debug unchanged...
};

/*==============================================================*
 *  ✅ ADD THESE HELPERS RIGHT HERE (after updateStarPhysics)
 *==============================================================*/

/**
 * Apply a vertical-wall bounce (left/right).
 * - wallX: x coord of the wall line
 * - wallSign: +1 bounce right, -1 bounce left
 * - outVx/outVy: caller computed post-bounce velocity
 * - pushOut: how far to place star away from the wall
 * - cooldownMs: optional anti-double-hit
 * - clearMomentum: whether to zero STAR.momentumX/Y (true for paddle ball)
 */
function bounceVertical(STAR, wallX, wallSign, outVx, outVy, pushOut, NOW, cooldownMs = 0, clearMomentum = true) {
  if (cooldownMs > 0) {
    const last = STAR.lastBounceV_Ms || 0;
    if (NOW - last < cooldownMs) return false;
    STAR.lastBounceV_Ms = NOW;
  }

  STAR.vx = outVx;
  STAR.vy = outVy;

  if (clearMomentum) {
    STAR.momentumX = 0;
    STAR.momentumY = 0;
  }

  STAR.x = wallX + wallSign * pushOut;
  return true;
}

/**
 * Apply a horizontal-wall bounce (top/bottom).
 * - wallY: y coord of the wall line
 * - wallSign: +1 bounce down, -1 bounce up
 * - outVx/outVy: caller computed post-bounce velocity
 * - pushOut: how far to place star away from the wall
 * - cooldownMs: optional anti-double-hit
 * - clearMomentum: whether to zero STAR.momentumX/Y
 */
function bounceHorizontal(STAR, wallY, wallSign, outVx, outVy, pushOut, NOW, cooldownMs = 0, clearMomentum = true) {
  if (cooldownMs > 0) {
    const last = STAR.lastBounceH_Ms || 0;
    if (NOW - last < cooldownMs) return false;
    STAR.lastBounceH_Ms = NOW;
  }

  STAR.vx = outVx;
  STAR.vy = outVy;

  if (clearMomentum) {
    STAR.momentumX = 0;
    STAR.momentumY = 0;
  }

  STAR.y = wallY + wallSign * pushOut;
  return true;
}