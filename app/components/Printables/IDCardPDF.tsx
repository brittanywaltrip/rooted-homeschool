import {
  Document,
  Image,
  Line,
  Page,
  Path,
  StyleSheet,
  Svg,
  Text,
  View,
} from "@react-pdf/renderer";

/* IDCardPDF. React-PDF Document for a single homeschool ID card. Landscape
 * 3.4 x 2.1 inches (245pt x 151pt). Sage-green Canva-style design with an
 * organic blob on the left, initials circle, name + role + academy + year on
 * the right, and a CODE128 barcode + ID number along the bottom.
 *
 * Initials-only by design — there's no per-child photo column in the
 * current schema. The Image branch is reserved for a future photo upload. */

export interface IDCardData {
  name: string;
  role: "Student" | "Educator";
  gradeOrLabel?: string;
  schoolName: string;
  year: string;
  /** Reserved. Always null in the current schema. */
  photoDataUrl: string | null;
  initials: string;
  idNumber: string;
  barcodeDataUrl: string;
}

const CARD_WIDTH = 245;
const CARD_HEIGHT = 151;

const COLORS = {
  brand: "#2D5A3D",
  mid: "#3d5c48",
  accent: "#5c7f63",
  white: "#FFFFFF",
  off: "#E8EDE9",
} as const;

const styles = StyleSheet.create({
  page: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    backgroundColor: COLORS.brand,
    flexDirection: "row",
    position: "relative",
  },
  svgOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
  },
  photoArea: {
    width: 100,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2,
  },
  photoCircle: {
    width: 62,
    height: 62,
    borderRadius: 31,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: COLORS.off,
    backgroundColor: COLORS.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  photoImage: { width: 62, height: 62, objectFit: "cover" },
  initialsText: { fontSize: 20, fontFamily: "Helvetica-Bold", color: COLORS.white },
  infoArea: {
    flex: 1,
    justifyContent: "center",
    paddingRight: 14,
    paddingLeft: 4,
    paddingTop: 12,
    paddingBottom: 28,
  },
  name: { fontSize: 13, fontFamily: "Helvetica-Bold", color: COLORS.white, marginBottom: 3 },
  role: {
    fontSize: 8,
    fontFamily: "Helvetica",
    color: COLORS.off,
    marginBottom: 2,
    letterSpacing: 1.5,
    textTransform: "uppercase",
  },
  gradeLabel: { fontSize: 8, fontFamily: "Helvetica", color: COLORS.off, marginBottom: 2, opacity: 0.85 },
  schoolName: { fontSize: 7.5, fontFamily: "Helvetica", color: COLORS.off, opacity: 0.75, marginBottom: 2 },
  year: { fontSize: 7, fontFamily: "Helvetica", color: COLORS.off, opacity: 0.65 },
  bottomBar: { position: "absolute", bottom: 8, left: 0, right: 0, alignItems: "center" },
  barcodeImage: { width: 110, height: 28, objectFit: "contain" },
  idNumber: {
    fontSize: 6.5,
    fontFamily: "Helvetica",
    color: COLORS.off,
    opacity: 0.7,
    marginTop: 1,
    letterSpacing: 2,
  },
});

export function IDCardPDF({ data }: { data: IDCardData }) {
  return (
    <Document title={`Rooted ID ${data.name}`} author="Rooted Homeschool">
      <Page
        size={{ width: CARD_WIDTH, height: CARD_HEIGHT }}
        style={styles.page}
        orientation="landscape"
      >
        {/* Background organic blob + corner squiggles */}
        <Svg style={styles.svgOverlay} viewBox={`0 0 ${CARD_WIDTH} ${CARD_HEIGHT}`}>
          <Path
            d={`M 0 0 L 105 0 Q 115 10 110 40 Q 115 80 105 110 Q 100 145 0 ${CARD_HEIGHT} Z`}
            fill={COLORS.mid}
          />
          <Line x1="210" y1="8" x2="225" y2="8" stroke={COLORS.accent} strokeWidth="1.5" strokeLinecap="round" />
          <Line x1="215" y1="14" x2="235" y2="14" stroke={COLORS.accent} strokeWidth="1.5" strokeLinecap="round" />
          <Line x1="218" y1="20" x2="230" y2="20" stroke={COLORS.accent} strokeWidth="1.5" strokeLinecap="round" />
          <Line x1="5" y1="130" x2="18" y2="130" stroke={COLORS.accent} strokeWidth="1" strokeLinecap="round" />
          <Line x1="5" y1="136" x2="14" y2="136" stroke={COLORS.accent} strokeWidth="1" strokeLinecap="round" />
          <Line x1="5" y1="142" x2="20" y2="142" stroke={COLORS.accent} strokeWidth="1" strokeLinecap="round" />
        </Svg>

        {/* Photo area — initials by default; image branch reserved */}
        <View style={styles.photoArea}>
          <View style={styles.photoCircle}>
            {data.photoDataUrl ? (
              /* eslint-disable-next-line jsx-a11y/alt-text -- React-PDF Image, not DOM */
              <Image src={data.photoDataUrl} style={styles.photoImage} />
            ) : (
              <Text style={styles.initialsText}>{data.initials}</Text>
            )}
          </View>
        </View>

        {/* Info area */}
        <View style={styles.infoArea}>
          <Text style={styles.name}>{data.name}</Text>
          <Text style={styles.role}>{data.role}</Text>
          {data.gradeOrLabel ? <Text style={styles.gradeLabel}>{data.gradeOrLabel}</Text> : null}
          <Text style={styles.schoolName}>{data.schoolName}</Text>
          <Text style={styles.year}>{data.year}</Text>
        </View>

        {/* Bottom barcode */}
        <View style={styles.bottomBar}>
          {/* eslint-disable-next-line jsx-a11y/alt-text -- React-PDF Image, not DOM */}
          <Image src={data.barcodeDataUrl} style={styles.barcodeImage} />
          <Text style={styles.idNumber}>{data.idNumber}</Text>
        </View>
      </Page>
    </Document>
  );
}
