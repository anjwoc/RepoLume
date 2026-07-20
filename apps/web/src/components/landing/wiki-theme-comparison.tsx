"use client";

import Image from "next/image";
import { ArrowLeftRight } from "lucide-react";
import { type CSSProperties, useId, useState } from "react";
import styles from "./landing-page.module.css";

type ComparisonStyle = CSSProperties & {
  "--comparison-position": string;
};

export function WikiThemeComparison() {
  const [position, setPosition] = useState(48);
  const captionId = useId();
  const comparisonStyle: ComparisonStyle = {
    "--comparison-position": `${position}%`,
  };

  return (
    <figure className={styles.appCapture}>
      <div className={styles.comparisonViewport} style={comparisonStyle}>
        <Image
          className={styles.comparisonImage}
          src="/grok-build-wiki-dark.png"
          alt="grok-build를 분석해 생성한 RepoLume 위키의 다크 테마 화면"
          width={1360}
          height={850}
          sizes="(max-width: 1050px) calc(100vw - 40px), 790px"
          priority
        />
        <div className={styles.lightImageClip} aria-hidden="true">
          <Image
            className={styles.comparisonImage}
            src="/grok-build-wiki-light.png"
            alt=""
            width={1360}
            height={850}
            sizes="(max-width: 1050px) calc(100vw - 40px), 790px"
            priority
          />
        </div>

        <span className={`${styles.themeLabel} ${styles.lightThemeLabel}`}>LIGHT</span>
        <span className={`${styles.themeLabel} ${styles.darkThemeLabel}`}>DARK</span>

        <input
          className={styles.comparisonRange}
          type="range"
          min="0"
          max="100"
          step="1"
          value={position}
          aria-label="라이트 테마와 다크 테마 화면 비교"
          aria-valuetext={`라이트 테마 ${position}%, 다크 테마 ${100 - position}%`}
          aria-describedby={captionId}
          onChange={(event) => setPosition(Number(event.currentTarget.value))}
        />

        <span className={styles.comparisonDivider} aria-hidden="true" />
        <span className={styles.comparisonHandle} aria-hidden="true">
          <ArrowLeftRight size={18} strokeWidth={2.1} />
        </span>
      </div>

      <figcaption id={captionId}>
        <strong>grok-build를 분석해 생성한 위키 문서</strong>
        <span>동일 화면 · Light / Dark</span>
      </figcaption>
      <p className={styles.comparisonHint} aria-hidden="true">
        <span />
        세로 핸들을 드래그해 테마 비교
        <span />
      </p>
    </figure>
  );
}
