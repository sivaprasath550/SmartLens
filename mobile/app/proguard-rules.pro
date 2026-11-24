# Gson maps JSON onto these classes by field name via reflection.
-keep class com.smartlens.app.data.api.** { *; }
-keepattributes Signature, *Annotation*, EnclosingMethod, InnerClasses

# Retrofit
-keep,allowobfuscation,allowshrinking interface retrofit2.Call
-keep,allowobfuscation,allowshrinking class retrofit2.Response
-keep,allowobfuscation,allowshrinking class kotlin.coroutines.Continuation
-dontwarn okhttp3.internal.platform.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**
