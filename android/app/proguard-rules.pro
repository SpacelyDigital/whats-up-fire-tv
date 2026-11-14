# The app has no reflection and no JavaScript interface classes (the page talks to it through
# WebViewCompat.addWebMessageListener), so R8's defaults do. Line numbers stay for crash reports.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
