import { motion } from "framer-motion";
import { EASE } from "./landingUtils";

export function Reveal({ children, delay = 0, className, style }) {
  return (
    <motion.div
      className={className}
      style={style}
      initial={{ opacity: 0, y: 32 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.9, delay, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

/**
 * Section heading. `layout`:
 *  - "center": stacked and centered
 *  - "split":  title left, supporting copy right (desktop)
 *  - "left":   stacked, left aligned
 */
export function SectionHead({ eyebrow, title, sub, layout = "center" }) {
  return (
    <Reveal className={`lp-head lp-head--${layout}`}>
      <div>
        <span className="lp-eyebrow lp-mono">{eyebrow}</span>
        <h2 className="lp-h2">{title}</h2>
      </div>
      {sub && <p className="lp-sub">{sub}</p>}
    </Reveal>
  );
}
