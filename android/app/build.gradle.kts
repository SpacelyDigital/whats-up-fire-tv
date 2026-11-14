import java.util.Properties
import javax.inject.Inject
import org.gradle.api.artifacts.component.ModuleComponentIdentifier
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Signing keys stay outside the repository, in a properties file named by WHATSUP_SIGNING or at
// ~/.whatsup-android/signing.properties, with personal.storeFile, personal.storePassword,
// personal.keyAlias, personal.keyPassword, and the same for upload. (the Google Play upload key).
// storeFile is relative to the properties file. Without them: the personal build is signed with
// the debug key, the store build is left unsigned.
val signingFile = System.getenv("WHATSUP_SIGNING")?.let(::File)
    ?: File(System.getProperty("user.home"), ".whatsup-android/signing.properties")
val signingKeys = Properties().apply { if (signingFile.isFile) signingFile.inputStream().use(::load) }

// The User-Agent on the app's own requests names the app and its maker, as Nominatim's and
// Planespotters' terms ask. A contact address joins it when the build is given one
// (-Pwhatsup.contact=... or WHATSUP_CONTACT); the repository keeps none.
val contact: String = providers.gradleProperty("whatsup.contact")
    .orElse(providers.environmentVariable("WHATSUP_CONTACT")).orElse("").get().trim()
require(contact.isEmpty() || Regex("""[\w.+-]+@[\w.-]+""").matches(contact)) { "whatsup.contact: an email address" }
fun userAgent(version: String) = "WhatsUp-GoogleTV/$version (Spacely Digital${if (contact.isEmpty()) "" else "; $contact"})"

// -Pwhatsup.hide=tips,awake: Settings items the store build leaves out (scripts/build-web.mjs
// WHATSUP_HIDE). Off unless asked for; the personal build always has everything.
val storeHide: String = providers.gradleProperty("whatsup.hide").orElse("").get()

android {
    namespace = "com.spacelydigital.whatsup"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.spacelydigital.whatsup"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "1.0.0"
    }

    signingConfigs {
        for (name in listOf("personal", "upload")) {
            val store = signingKeys.getProperty("$name.storeFile") ?: continue
            create(name) {
                storeFile = signingFile.parentFile.resolve(store)
                storePassword = signingKeys.getProperty("$name.storePassword")
                keyAlias = signingKeys.getProperty("$name.keyAlias")
                keyPassword = signingKeys.getProperty("$name.keyPassword")
            }
        }
    }

    flavorDimensions += "edition"
    productFlavors {
        // Google Play.
        create("store") {
            dimension = "edition"
            versionCode = 1
            versionName = "1.0.0"
            buildConfigField("String", "USER_AGENT", "\"${userAgent("1.0")}\"")
            buildConfigField("boolean", "WEB_DEBUG", "false")
            signingConfig = signingConfigs.findByName("upload")
        }
        // The developer's own TVs: installs beside the store app, page inspectable over adb.
        create("personal") {
            dimension = "edition"
            applicationIdSuffix = ".personal"
            versionCode = 1
            versionName = "0.1.0"
            buildConfigField("String", "USER_AGENT", "\"${userAgent("0.1")}\"")
            buildConfigField("boolean", "WEB_DEBUG", "true")
            signingConfig = signingConfigs.findByName("personal") ?: signingConfigs.getByName("debug")
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            vcsInfo.include = false
        }
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
    }

    packaging {
        resources {
            excludes += setOf("META-INF/*.version", "META-INF/*.kotlin_module", "kotlin/**", "kotlin-tooling-metadata.json", "DebugProbesKt.bin")
        }
    }

    // Google Play's dependency report rides in the bundle only, never in an installed app.
    dependenciesInfo {
        includeInApk = false
        includeInBundle = true
    }

    lint {
        abortOnError = true
        checkReleaseBuilds = true
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

dependencies {
    implementation("androidx.webkit:webkit:1.18.0")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20260814")
}

// --- The page: scripts/build-credits.mjs and scripts/build-web.mjs (Node 20 or later) build the
// repository's web/ into each variant's assets, under www/.
abstract class BuildPage : DefaultTask() {
    @get:Input abstract val profile: Property<String>
    @get:Input abstract val release: Property<Boolean>
    @get:Input abstract val hide: Property<String>
    @get:Internal abstract val repo: DirectoryProperty
    @get:InputFiles @get:PathSensitive(PathSensitivity.RELATIVE) abstract val sources: ConfigurableFileCollection
    @get:OutputDirectory abstract val outputDir: DirectoryProperty
    @get:Inject abstract val exec: ExecOperations

    @TaskAction
    fun build() {
        val out = outputDir.get().asFile
        out.deleteRecursively()
        out.mkdirs()
        val env = mapOf(
            "WHATSUP_PLATFORM" to "android",
            "WHATSUP_PROFILE" to profile.get(),
            "WHATSUP_LICENSES" to File(temporaryDir, "licenses.txt").path,
            "WHATSUP_RELEASE" to if (release.get()) "1" else "0",
            "WHATSUP_HIDE" to hide.get(),
            "WHATSUP_OUT" to File(out, "www").path,
        )
        for (script in listOf("scripts/build-credits.mjs", "scripts/build-web.mjs")) {
            exec.exec {
                workingDir = repo.get().asFile
                environment(env)
                commandLine("node", script)
            }
        }
    }
}

val repoDir: File = rootDir.parentFile // web/ and scripts/, shared with the Fire TV app
androidComponents {
    onVariants { variant ->
        val flavor = variant.flavorName ?: "personal"
        val task = tasks.register<BuildPage>("buildPage${variant.name.replaceFirstChar { it.uppercase() }}") {
            profile.set(flavor)
            release.set(variant.buildType == "release")
            hide.set(if (flavor == "store") storeHide else "")
            repo.set(repoDir)
            sources.from(
                repoDir.resolve("web"), repoDir.resolve("scripts"), repoDir.resolve("THIRD_PARTY_NOTICES.md"),
                repoDir.resolve("vendor/package-lock.json"), file("libraries.txt"), rootDir.resolve("licenses"),
            )
            outputDir.set(layout.buildDirectory.dir("generated/page/${variant.name}"))
        }
        variant.sources.assets?.addGeneratedSourceDirectory(task, BuildPage::outputDir)
    }
}

// --- What ships: libraries.txt lists every library in the app ("group:name:version Apache-2.0"),
// for About & credits. The build stops when the app's libraries and the list part ways.
val checkLibraries by tasks.registering {
    val listed = file("libraries.txt")
    inputs.file(listed)
    doLast {
        val shipped = sortedSetOf<String>()
        for (config in listOf("storeReleaseRuntimeClasspath", "personalReleaseRuntimeClasspath")) {
            configurations.getByName(config).incoming.resolutionResult.allComponents
                .mapNotNull { it.id as? ModuleComponentIdentifier }
                .forEach { shipped += "${it.group}:${it.module}:${it.version}" }
        }
        val lines = listed.readLines().map { it.trim() }.filter { it.isNotEmpty() && !it.startsWith("#") }
        val bad = lines.filterNot { Regex("""[\w.-]+:[\w.-]+:[\w.-]+ Apache-2\.0""").matches(it) }
        if (bad.isNotEmpty()) throw GradleException("libraries.txt: unreadable, or not Apache-2.0: $bad")
        val inList = lines.map { it.substringBefore(' ') }.toSortedSet()
        if (shipped != inList) {
            throw GradleException("libraries.txt is out of date.\n  missing: ${shipped - inList}\n  not shipped: ${inList - shipped}")
        }
    }
}
tasks.named("preBuild") { dependsOn(checkLibraries) }
