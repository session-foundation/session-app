/**
 * The app's entry point, ahead of expo-router's.
 *
 * Installing the platform ports here is what makes their availability a fact rather than a
 * hope: expo-router builds its routes from a require.context over app/, and nothing
 * promises the root layout is evaluated before a route file that reaches for a port on the
 * way in.
 */
import './src/pluralRules'
import './src/platform'

import 'expo-router/entry'

import { LogBox } from 'react-native'

// Reduced motion is a setting, not a fault, and the dev build's toast for it covers the composer.
LogBox.ignoreLogs(['[Reanimated] Reduced motion setting is enabled'])
