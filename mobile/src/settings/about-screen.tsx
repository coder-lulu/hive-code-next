import { useState } from 'react'
import {
  PRODUCT_PUBLIC_LINKS,
  PRODUCT_SOURCE_REPOSITORY,
  PRODUCT_SOURCE_REPOSITORY_URL,
  productNameText
} from '@/product-brand'
import { ChevronLeft, ChevronRight, GitBranch, Globe, Share2 } from 'lucide-react-native'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { OrcaLogo } from '../components/OrcaLogo'
import {
  MobileGroupedList,
  MobileGroupedListRow,
  MobileIconButton,
  MobileScreenHeader
} from '../components/ui'
import type { MobileTheme } from '../theme/mobile-theme'
import { useMobileTheme, useMobileThemeStyles } from '../theme/mobile-theme-provider'

export default function AboutScreen({
  onBack,
  openExternal,
  versionLabel
}: {
  onBack: () => void
  openExternal: (url: string) => Promise<unknown>
  versionLabel: string
}) {
  const [error, setError] = useState<string | null>(null)
  const openLink = (url: string) => {
    setError(null)
    void openExternal(url).catch(() => setError('无法打开链接，请重试。'))
  }
  const sourceRepositoryUrl = PRODUCT_SOURCE_REPOSITORY_URL
  const insets = useSafeAreaInsets()
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createStyles)

  return (
    <View style={styles.screen}>
      <MobileScreenHeader
        leading={
          <MobileIconButton
            accessibilityLabel="返回"
            icon={ChevronLeft}
            iconSize={24}
            onPress={onBack}
          />
        }
        title={productNameText('关于 HiveCode')}
      />

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + theme.spacing.space32 }
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.brand}>
          <OrcaLogo size={32} />
          <Text maxFontSizeMultiplier={1.3} style={styles.brandName}>
            {productNameText('HiveCode')}
          </Text>
          <Text maxFontSizeMultiplier={1.3} style={styles.brandDescription}>
            开源智能体开发工作台
          </Text>
        </View>

        {PRODUCT_PUBLIC_LINKS.website || sourceRepositoryUrl || PRODUCT_PUBLIC_LINKS.social ? (
          <MobileGroupedList title="产品链接">
            {PRODUCT_PUBLIC_LINKS.website ? (
              <MobileGroupedListRow
                accessibilityLabel={productNameText('打开 HiveCode 官方网站')}
                leading={<Globe color={theme.color.text.secondary} size={20} strokeWidth={2} />}
                onPress={() => openLink(PRODUCT_PUBLIC_LINKS.website!)}
                title="官方网站"
                trailing={
                  <ChevronRight color={theme.color.text.tertiary} size={20} strokeWidth={2} />
                }
              />
            ) : null}
            {sourceRepositoryUrl ? (
              <MobileGroupedListRow
                accessibilityLabel={`打开源代码仓库 ${PRODUCT_SOURCE_REPOSITORY}`}
                leading={<GitBranch color={theme.color.text.secondary} size={20} strokeWidth={2} />}
                onPress={() => openLink(sourceRepositoryUrl)}
                title="源代码仓库"
                trailing={
                  <ChevronRight color={theme.color.text.tertiary} size={20} strokeWidth={2} />
                }
                value={PRODUCT_SOURCE_REPOSITORY ?? undefined}
              />
            ) : null}
            {PRODUCT_PUBLIC_LINKS.social ? (
              <MobileGroupedListRow
                accessibilityLabel={productNameText('打开 HiveCode 社交主页')}
                leading={<Share2 color={theme.color.text.secondary} size={20} strokeWidth={2} />}
                onPress={() => openLink(PRODUCT_PUBLIC_LINKS.social!)}
                title="社交主页"
                trailing={
                  <ChevronRight color={theme.color.text.tertiary} size={20} strokeWidth={2} />
                }
              />
            ) : null}
          </MobileGroupedList>
        ) : null}

        {error ? (
          <Text accessibilityRole="alert" style={styles.versionText}>
            {error}
          </Text>
        ) : null}
        <Text maxFontSizeMultiplier={1.3} style={styles.versionText}>
          版本 {versionLabel}
        </Text>
      </ScrollView>
    </View>
  )
}

function createStyles(theme: MobileTheme) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.color.bg.canvas },
    content: {
      flexGrow: 1,
      gap: theme.spacing.space24,
      paddingHorizontal: theme.spacing.space20,
      paddingTop: theme.spacing.space20
    },
    brand: {
      alignItems: 'center',
      gap: theme.spacing.space8,
      paddingVertical: theme.spacing.space24
    },
    brandName: { ...theme.typography.pageTitle, color: theme.color.text.primary },
    brandDescription: {
      ...theme.typography.meta,
      color: theme.color.text.secondary,
      textAlign: 'center'
    },
    versionText: {
      ...theme.typography.caption,
      color: theme.color.text.tertiary,
      textAlign: 'center'
    }
  })
}
