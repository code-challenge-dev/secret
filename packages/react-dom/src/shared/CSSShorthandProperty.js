/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// List derived from Gecko source code:
// https://github.com/mozilla/gecko-dev/blob/4e638efc71/layout/style/test/property_database.js
export const shorthandToLonghand = {
  animation: [
    'animationDelay',
    'animationDirection',
    'animationDuration',
    'animationFillMode',
    'animationIterationCount',
    'animationName',
    'animationPlayState',
    'animationTimingFunction',
  ],
  background: [
    'backgroundAttachment',
    'backgroundClip',
    'backgroundColor',
    'backgroundImage',
    'backgroundOrigin',
    'backgroundPositionX',
    'backgroundPositionY',
    'backgroundRepeat',
    'backgroundSize',
  ],
  backgroundPosition: ['backgroundPositionX', 'backgroundPositionY'],
  border: [
    'borderBottomColor',
    'borderBottomStyle',
    'borderBottomWidth',
    'borderImageOutset',
    'borderImageRepeat',
    'borderImageSlice',
    'borderImageSource',
    'borderImageWidth',
    'borderLeftColor',
    'borderLeftStyle',
    'borderLeftWidth',
    'borderRightColor',
    'borderRightStyle',
    'borderRightWidth',
    'borderTopColor',
    'borderTopStyle',
    'borderTopWidth',
  ],
  borderBlockEnd: [
    'borderBlockEndColor',
    'borderBlockEndStyle',
    'borderBlockEndWidth',
  ],
  borderBlockStart: [
    'borderBlockStartColor',
    'borderBlockStartStyle',
    'borderBlockStartWidth',
  ],
  borderBottom: ['borderBottomColor', 'borderBottomStyle', 'borderBottomWidth'],
  borderColor: [
    'borderBottomColor',
    'borderLeftColor',
    'borderRightColor',
    'borderTopColor',
  ],
  borderImage: [
    'borderImageOutset',
    'borderImageRepeat',
    'borderImageSlice',
    'borderImageSource',
    'borderImageWidth',
  ],
  borderInlineEnd: [
    'borderInlineEndColor',
    'borderInlineEndStyle',
    'borderInlineEndWidth',
  ],
  borderInlineStart: [
    'borderInlineStartColor',
    'borderInlineStartStyle',
    'borderInlineStartWidth',
  ],
  borderLeft: ['borderLeftColor', 'borderLeftStyle', 'borderLeftWidth'],
  borderRadius: [
    'borderBottomLeftRadius',
    'borderBottomRightRadius',
    'borderTopLeftRadius',
    'borderTopRightRadius',
  ],
  borderRight: ['borderRightColor', 'borderRightStyle', 'borderRightWidth'],
  borderStyle: [
    'borderBottomStyle',
    'borderLeftStyle',
    'borderRightStyle',
    'borderTopStyle',
  ],
  borderTop: ['borderTopColor', 'borderTopStyle', 'borderTopWidth'],
  borderWidth: [
    'borderBottomWidth',
    'borderLeftWidth',
    'borderRightWidth',
    'borderTopWidth',
  ],
  columnRule: ['columnRuleColor', 'columnRuleStyle', 'columnRuleWidth'],
  columns: ['columnCount', 'columnWidth'],
  flex: ['flexBasis', 'flexGrow', 'flexShrink'],
  flexFlow: ['flexDirection', 'flexWrap'],
  font: [
    'fontFamily',
    'fontFeatureSettings',
    'fontKerning',
    'fontLanguageOverride',
    'fontSize',
    'fontSizeAdjust',
    'fontStretch',
    'fontStyle',
    'fontVariant',
    'fontVariantAlternates',
    'fontVariantCaps',
    'fontVariantEastAsian',
    'fontVariantLigatures',
    'fontVariantNumeric',
    'fontVariantPosition',
    'fontWeight',
    'lineHeight',
  ],
  fontVariant: [
    'fontVariantAlternates',
    'fontVariantCaps',
    'fontVariantEastAsian',
    'fontVariantLigatures',
    'fontVariantNumeric',
    'fontVariantPosition',
  ],
  gap: ['columnGap', 'rowGap'],
  grid: [
    'gridAutoColumns',
    'gridAutoFlow',
    'gridAutoRows',
    'gridTemplateAreas',
    'gridTemplateColumns',
    'gridTemplateRows',
  ],
  gridArea: ['gridColumnEnd', 'gridColumnStart', 'gridRowEnd', 'gridRowStart'],
  gridColumn: ['gridColumnEnd', 'gridColumnStart'],
  gridColumnGap: ['columnGap'],
  gridGap: ['columnGap', 'rowGap'],
  gridRow: ['gridRowEnd', 'gridRowStart'],
  gridRowGap: ['rowGap'],
  gridTemplate: [
    'gridTemplateAreas',
    'gridTemplateColumns',
    'gridTemplateRows',
  ],
  listStyle: ['listStyleImage', 'listStylePosition', 'listStyleType'],
  margin: ['marginBottom', 'marginLeft', 'marginRight', 'marginTop'],
  marker: ['markerEnd', 'markerMid', 'markerStart'],
  mask: [
    'maskClip',
    'maskComposite',
    'maskImage',
    'maskMode',
    'maskOrigin',
    'maskPositionX',
    'maskPositionY',
    'maskRepeat',
    'maskSize',
  ],
  maskPosition: ['maskPositionX', 'maskPositionY'],
  outline: ['outlineColor', 'outlineStyle', 'outlineWidth'],
  overflow: ['overflowX', 'overflowY'],
  padding: ['paddingBottom', 'paddingLeft', 'paddingRight', 'paddingTop'],
  placeContent: ['alignContent', 'justifyContent'],
  placeItems: ['alignItems', 'justifyItems'],
  placeSelf: ['alignSelf', 'justifySelf'],
  textDecoration: [
    'textDecorationColor',
    'textDecorationLine',
    'textDecorationStyle',
  ],
  textEmphasis: ['textEmphasisColor', 'textEmphasisStyle'],
  transition: [
    'transitionDelay',
    'transitionDuration',
    'transitionProperty',
    'transitionTimingFunction',
  ],
  wordWrap: ['overflowWrap'],
};
