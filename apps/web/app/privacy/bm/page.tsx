import Link from "next/link";

export const metadata = { title: "Privasi · Fikirtive" };

/** BM(Bahasa Malaysia)版隐私告知 —— 2026-07-28 跨族复审返工 P0-3:PDPA 告知双语。
 *  内容与英文版 app/privacy/page.tsx(第五轮返工后)逐节对应;英文版是事实基线的来源,
 *  任何后续改动先改英文版、再同步本页,两页顶部互挂语言切换(English | Bahasa Malaysia)。
 *  译文与「以哪个语言版本为准」待 Founder/法务确认(见 PR 决定清单)。
 *  免登录:proxy.ts 的 matcher 以 "privacy" 前缀放行,/privacy/bm 一并覆盖。
 *  供应商保密同英文版:只写服务类别,不点名(Stripe/Google/Meta 为用户直接交互平台,保留)。*/
export default function PrivacyPageBm() {
  return (
    <main className="gb min-h-[100dvh] bg-background px-6 py-10 text-foreground">
      <article className="mx-auto max-w-[720px]">
        <Link href="/login" className="text-sm font-semibold text-muted-foreground underline underline-offset-4">
          Kembali ke log masuk
        </Link>
        <p className="mt-3 text-sm text-muted-foreground">
          <Link href="/privacy" className="underline underline-offset-4">English</Link>
          {" | "}
          <span className="font-semibold text-foreground">Bahasa Malaysia</span>
        </p>
        <h1 className="mt-8 text-[34px] font-bold tracking-[-0.02em]">Dasar privasi Fikirtive</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Berkuat kuasa 28 Julai 2026 · Kemas kini terakhir 28 Julai 2026
        </p>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Fikirtive dikendalikan oleh BELCORT SDN BHD, sebuah syarikat yang berdaftar di Malaysia. Notis ini
          menerangkan produk sebagaimana ia berfungsi hari ini, semasa fasa beta jemputan sahaja. Ia menerangkan
          maklumat yang kami simpan, sebab kami menyimpannya, pihak lain yang memprosesnya, dan cara memintanya
          dibuang.
        </p>

        <section className="mt-8 space-y-4 text-[15px] leading-7 text-muted-foreground">
          <h2 className="text-lg font-semibold text-foreground">Dua kumpulan orang yang berbeza diterangkan di sini</h2>
          <p>
            Hampir semua kekeliruan tentang alat seperti ini datang daripada mencampuradukkan dua kumpulan, jadi kami
            mengasingkannya sepanjang notis ini:
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <span className="font-semibold text-foreground">Anda, peniaga.</span> Anda log masuk, anda memuat naik
              bahan anda, anda memutuskan apa yang diterbitkan atau dibayar.
            </li>
            <li>
              <span className="font-semibold text-foreground">Pelanggan anda sendiri.</span> Kami menyimpan maklumat
              tentang mereka hanya kerana anda memasukkannya ke dalam Fikirtive. Kami tidak mengumpulnya daripada
              mereka, kami tidak memperolehnya dari mana-mana sumber lain, dan Fikirtive tidak menghubungi mereka.
            </li>
          </ul>
          <p>
            Anda mengawal maklumat pelanggan yang anda masukkan ke dalam Fikirtive, dan kami memprosesnya mengikut
            arahan anda. Jika pelanggan anda mempunyai soalan atau permintaan tentang maklumat mereka, mereka perlu
            mengemukakannya kepada anda. Fikirtive tiada saluran penghantaran atau penerimaan kepada pelanggan anda,
            jadi ia tidak dapat memaklumkan mereka bagi pihak anda. Lihat{" "}
            <Link href="/terms" className="underline underline-offset-4">Terma</Link>.
          </p>

          <h2 className="pt-4 text-lg font-semibold text-foreground">Maklumat tentang anda (peniaga)</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <span className="text-foreground">Akaun dan log masuk.</span> Alamat e-mel anda, nama anda, dan gambar
              profil anda jika penyedia log masuk anda membekalkannya. Kelayakan log masuk anda disimpan secara
              berasingan oleh pustaka pengesahan yang digunakan produk ini: untuk log masuk e-mel dan kata laluan,
              kata laluan anda dalam bentuk cincangan (hash); untuk log masuk Google, pengecam akaun dan token yang
              Google kembalikan kepada kami.
            </li>
            <li>
              <span className="text-foreground">Rekod sesi.</span> Rekod bagi setiap sesi log masuk. Pustaka
              pengesahan menyimpan alamat IP dan user-agent pelayar yang dilihatnya pada permintaan itu
              bersama-samanya.
            </li>
            <li>
              <span className="text-foreground">Hasil kerja yang anda cipta.</span> Fail dan imej yang dimuat naik,
              prompt yang anda tulis, nota yang anda minta Otto ingat, rekod jenama yang anda simpan — huraian
              audiens anda, serta tawaran dan produk anda termasuk sebarang harga yang anda taip — imej dan video
              yang dijana, data kempen dan jadual.
            </li>
            <li>
              <span className="text-foreground">Perbualan Otto.</span> Teks penuh sembang anda dengan Otto, termasuk
              apa sahaja yang anda tampal ke dalamnya.
            </li>
            <li>
              <span className="text-foreground">Transkrip.</span> Jika sesebuah fail ditranskripsikan, teks transkrip
              itu.
            </li>
            <li>
              <span className="text-foreground">Kredit dan pembelian.</span> Baki kredit anda dan lejar kredit
              (setiap tempahan, penyelesaian dan bayaran balik), serta peristiwa pembayaran yang dilaporkan Stripe
              kembali kepada kami. Pembelian kredit berlaku di halaman pembayaran yang dihoskan oleh Stripe: butiran
              kad anda dimasukkan di halaman Stripe dan tidak sekali-kali melalui Fikirtive. Kami menghantar kepada
              Stripe alamat e-mel anda, pek yang anda pilih, dan pengecam dalaman ruang kerja anda bersama bilangan
              kredit untuk pek itu, supaya kredit itu masuk ke ruang kerja yang betul apabila pembayaran selesai.
            </li>
            <li>
              <span className="text-foreground">Akaun yang disambungkan.</span> Jika anda menyambungkan Meta, kami
              menyimpan token akses (disulitkan), ID pengguna Meta anda, dan kebenaran yang diberikan Meta. Apabila
              anda menjadualkan hantaran, Halaman Facebook atau akaun Instagram yang anda pilih untuk hantaran itu
              disimpan bersama hantaran tersebut.
            </li>
            <li>
              <span className="text-foreground">Rekod audit.</span> Rekod bertarikh bagi tindakan penting dalam ruang
              kerja anda, supaya kami dapat melihat apa yang berlaku apabila anda meminta kami menyiasat sesuatu.
            </li>
          </ul>

          <h2 className="pt-4 text-lg font-semibold text-foreground">Maklumat tentang pelanggan anda</h2>
          <p>Apa yang boleh disimpan dalam rekod kenalan hari ini:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              Nama, peringkat kitaran hayat, dari mana kenalan itu datang, dan tarikh anda menambah kenalan itu —
              disimpan sebagai tarikh pertama dilihat dan tarikh terakhir dilihat, kedua-duanya ditetapkan semasa
              rekod itu dicipta.
            </li>
            <li>
              Status persetujuan pemasaran (setuju, tidak setuju, atau tidak diketahui), dari mana persetujuan itu
              datang dan bila ia direkodkan, serta penanda jangan-ganggu.
            </li>
          </ul>
          <p>
            Ruang kerja anda juga boleh menyimpan struktur yang anda bina di sekeliling rekod tersebut — segmen
            kenalan, pilihan audiens siaran, dan konfigurasi aliran kerja automasi.
          </p>
          <p>
            <span className="font-semibold text-foreground">Apa yang sengaja tidak kami simpan.</span> Apabila anda
            mengimport kenalan daripada CSV, lajur telefon, WhatsApp dan e-mel digunakan hanya untuk memberi amaran
            tentang kemungkinan pendua, dan kemudiannya dibuang, bukan disimpan. Hasil import menyatakannya di skrin.
            Rekod kenalan tidak mempunyai nombor telefon, nombor WhatsApp atau alamat e-mel, dan tiada apa-apa dalam
            produk ini yang menulisnya. Kami juga tidak menyimpan sebarang nama pengguna sosial atau pengecam
            platform untuk pelanggan anda: tiada cara untuk menambahnya, dan cubaan untuk melampirkannya akan
            ditolak.
          </p>
          <p>
            <span className="font-semibold text-foreground">Apa yang Fikirtive tidak lakukan.</span> Fikirtive tidak
            menghantar mesej kepada pelanggan anda dan tidak menerima mesej daripada mereka. Tiada laluan penghantaran
            atau penerimaan langsung dalam produk ini hari ini; meja kerja mesej hanya menjalankan penghantaran
            simulasi.
          </p>

          <h2 className="pt-4 text-lg font-semibold text-foreground">Dari mana maklumat itu datang</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>Anda — semua yang anda taip, muat naik, import atau sambungkan.</li>
            <li>Google, jika anda memilih untuk log masuk dengan akaun Google.</li>
            <li>
              Meta, jika anda menyambungkan akaun Meta: ID pengguna Meta anda dan kebenaran yang diberikan. Halaman,
              akaun Instagram dan akaun iklan anda dibaca daripada Meta semasa anda berada di skrin yang
              memerlukannya. Apa yang kami simpan ialah Halaman atau akaun Instagram yang anda pilih untuk hantaran
              berjadual, dan — setelah penerbitan dicuba — pengecam hantaran dan media yang dihasilkan oleh
              penerbitan itu, sebagai sebahagian daripada sejarah hantaran tersebut.
            </li>
            <li>Stripe, apabila pembelian kredit selesai.</li>
            <li>Sistem kami sendiri — rekod sesi dan rekod audit yang tercipta semasa anda menggunakan produk.</li>
          </ul>

          <h2 className="pt-4 text-lg font-semibold text-foreground">Untuk apa kami menggunakannya</h2>
          <p>
            Untuk melog masuk anda, mengehadkan data anda kepada ruang kerja anda sendiri, mengukur dan
            menyelesaikan kredit, menjalankan Otto, menghasilkan dan menyimpan media yang dijana, menerbitkan apa
            yang anda jadualkan, menunjukkan sejarah dan hasil penjanaan anda sendiri, serta memastikan perkhidmatan
            berjalan dan menyahpepijatnya.
          </p>
          <p>
            Jika hantaran berjadual menghadapi masalah, kami menyimpan sebabnya pada hantaran itu. Masalah yang
            mungkin masih boleh diselesaikan ditandakan sebagai memerlukan perhatian; kegagalan keras yang tidak
            dapat diperbaiki dengan cubaan semula ditandakan sebagai gagal. Dalam kedua-dua keadaan, anda melihat apa
            yang berlaku apabila anda membuka jadual anda. Fikirtive tidak menghantar peringatan, e-mel atau sebarang
            mesej lain kepada anda tentang hantaran berjadual.
          </p>
          <p>
            Kami tidak menggunakan kandungan ruang kerja anda untuk memberi pelanggan Fikirtive yang lain akses
            kepada fail, kenalan atau kempen anda.
          </p>
          <p>
            Aplikasi Fikirtive tidak mengandungi skrip pengiklanan atau penjejakan analitik pihak ketiga. Kami
            menggunakan kuki untuk mengekalkan log masuk anda.
          </p>

          <h2 className="pt-4 text-lg font-semibold text-foreground">Siapa lagi yang memprosesnya</h2>
          <p>
            Fikirtive berjalan di atas infrastruktur yang dihoskan dan menggunakan penyedia perkhidmatan. Setiap satu
            hanya menerima apa yang diperlukan oleh peranannya. Kami menerangkan penyedia infrastruktur mengikut
            kategori perkhidmatan; platform yang anda berinteraksi dengannya secara langsung — Stripe, Google dan
            Meta — dinamakan:
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              Penyedia pengehosan awan dan penyedia pangkalan data terurus, yang menjalankan aplikasi dan menyimpan
              datanya.
            </li>
            <li>Penyedia storan fail dan penghantaran kandungan, yang menyimpan fail yang dimuat naik dan dijana.</li>
            <li>Pembayaran — Stripe.</li>
            <li>Perkhidmatan penghantaran e-mel, yang menghantar e-mel transaksi seperti pautan log masuk.</li>
            <li>Perkhidmatan pemantauan ralat, yang mungkin menerima butiran permintaan yang gagal.</li>
            <li>Log masuk dengan Google — Google.</li>
            <li>Penyedia carian web, apabila Otto membuat penyelidikan. Teks pertanyaan anda dihantar.</li>
            <li>Akaun iklan dan sosial yang disambungkan — Meta.</li>
            <li>
              Penyedia infrastruktur AI pihak ketiga, yang memproses kandungan untuk menghasilkan balasan Otto dan
              media janaan anda. Kami menamakan mereka mengikut kategori dan bukan secara individu, kerana penyedia
              yang kami gunakan adalah rahsia komersial.
            </li>
          </ul>
          <p>
            <span className="font-semibold text-foreground">
              Apa yang sampai kepada penyedia AI wajar dinyatakan dengan jelas.
            </span>{" "}
            Setiap kali Otto membalas, penyedia menerima perbualan setakat itu dan konteks jenama anda — nota yang
            Otto ingat, dan rekod jenama anda: huraian audiens yang anda tulis, serta tawaran dan produk yang anda
            rekodkan, termasuk harga yang anda masukkan. Imej yang anda seret ke dalam perbualan dihantar bersamanya.
            Jika Otto bekerja dengan senarai kenalan anda, butiran kenalan yang sedang dikerjakannya turut dihantar.
            Untuk penjanaan imej dan video, penyedia menerima prompt anda dan pautan yang membolehkannya memuat turun
            imej atau video sumber tertentu dari storan kami; pautan itu berhenti berfungsi selepas satu jam.
          </p>
          <p>
            Ini adalah perkhidmatan antarabangsa, jadi maklumat anda mungkin diproses di luar Malaysia.
          </p>

          <h2 className="pt-4 text-lg font-semibold text-foreground">
            Siapa di Belcort yang boleh melihat ruang kerja anda
          </h2>
          <p>
            Kami lebih rela menyatakannya dengan terus terang daripada membiarkannya kabur. Akses ke kawasan
            pentadbiran dalaman terhad kepada senarai tetap alamat e-mel pengasas. Dari situ:
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              Seorang pengasas boleh menyenaraikan perbualan Otto terkini merentas semua ruang kerja, bagi menyokong
              dan menyahpepijat produk. Apa yang ditunjukkan oleh senarai itu ialah ruang kerja dan projek mana
              perbualan itu tergolong, berapa banyak mesej di dalamnya, dan bila ia terakhir aktif. Membaca teks
              mesej itu sendiri tidak dibina: skrin dalaman itu sengaja tidak memuatkan prompt, transkrip, media
              atau muatan mentah.
            </li>
            <li>
              Seorang pengasas boleh membuka satu ruang kerja dan melihat alamat e-mel pemilik, baki kredit dan apa
              yang sedang ditempah, entri lejar kredit terkini, jumlah keseluruhan kos penjanaan, bilangan projek dan
              item janaan, serta jenis dan tarikh rekod audit terkini. Merentas semua ruang kerja, kawasan yang sama
              menyenaraikan aktiviti terkini sebagai metadata sahaja — bagi satu penjanaan: ruang kerja, projek, sama
              ada imej atau video, dan masanya; bagi kerja berbayar: kosnya dan masanya; dan rekod audit terkini
              mengikut jenis dan masa. Ia tidak menunjukkan prompt, fail yang dijana, atau teks mesej.
            </li>
            <li>
              Seorang pengasas boleh log masuk sebagai pemilik ruang kerja untuk menghasilkan semula sesuatu masalah.
              Berbuat demikian memerlukan sebab bertulis ditaip, direkodkan dalam rekod audit, dan menyekat semua
              perbelanjaan selagi ia aktif.
            </li>
          </ul>

          <h2 className="pt-4 text-lg font-semibold text-foreground">Pilihan dan kawalan anda</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              Putuskan sambungan Meta dari skrin Connections. Ini disekat semasa seorang pengasas sedang log masuk
              sebagai anda.
            </li>
            <li>
              Suis jeda pada skrin yang sama membolehkan anda menghentikan penulisan iklan tanpa memutuskan
              sambungan. Ia juga disekat semasa seorang pengasas sedang log masuk sebagai anda.
            </li>
            <li>
              Rekodkan persetujuan atau penarikan diri pada sesuatu kenalan, dan tetapkan jangan-ganggu pada
              mana-mana kenalan.
            </li>
            <li>
              Alamat e-mel anda diperlukan — tanpanya tiada akaun dan anda tidak boleh log masuk. Sesetengah rekod
              terhasil semata-mata kerana menggunakan perkhidmatan: sesi log masuk, alamat IP dan butiran pelayar
              yang direkodkan bersamanya, serta rekod audit bagi tindakan penting. Apa yang anda tambah selain itu
              terpulang kepada anda: jika anda tidak memuat naik fail, mengimport kenalan atau menyambungkan akaun,
              ciri-ciri itu tidak melakukan apa-apa.
            </li>
          </ul>

          <h2 className="pt-4 text-lg font-semibold text-foreground">Akses, pembetulan dan pemadaman</h2>
          <p>
            Untuk meminta salinan data anda, pembetulan, atau pemadaman, hubungi kami di{" "}
            <a href="mailto:tao@belcort.com" className="underline underline-offset-4">tao@belcort.com</a> daripada
            alamat yang anda gunakan untuk log masuk. Buat masa ini tiada aliran layan diri automatik untuk
            permintaan ini.
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <span className="text-foreground">Sambungan Meta.</span> Automatik. Membuang Fikirtive dalam tetapan
              Facebook anda memadamkan sambungan yang disimpan dan token aksesnya — lihat{" "}
              <Link href="/legal/data-deletion" className="underline underline-offset-4">pemadaman data</Link> untuk
              apa yang dibuang dan apa yang tidak.
            </li>
            <li>
              <span className="text-foreground">Keseluruhan akaun dan ruang kerja anda.</span> Hubungi kami untuk
              membuat permintaan. Butang dalam Account membuka e-mel itu; ia tidak memadamkan apa-apa dengan
              sendirinya.
            </li>
            <li>
              <span className="text-foreground">Kenalan individu.</span> Rekod kenalan tidak boleh dipadamkan dari
              antara muka hari ini. Hubungi kami untuk meminta pembuangannya.
            </li>
          </ul>
          <p>
            Kami menyimpan maklumat anda selagi ruang kerja anda dibuka. Dua batasan wajar diketahui. Rekod yang
            dipadamkan boleh kekal untuk suatu tempoh dalam sandaran pangkalan data dan dalam tetingkap pemulihan
            point-in-time penyedia pangkalan data kami; snapshot pangkalan data kami sendiri dibersihkan secara
            bergolek, jadi snapshot yang berusia lebih daripada kira-kira 30 hari akan dipadamkan semasa larian
            sandaran yang kemudian. Dan fail yang disimpan belum lagi dibuang oleh kerja pembersihan automatik.
          </p>

          <h2 className="pt-4 text-lg font-semibold text-foreground">Dengan siapa anda berurusan</h2>
          <p>
            Fikirtive dikendalikan oleh BELCORT SDN BHD, sebuah syarikat yang berdaftar di Malaysia. Soalan,
            permintaan dan aduan tentang data peribadi:{" "}
            <a href="mailto:tao@belcort.com" className="underline underline-offset-4">tao@belcort.com</a>.
          </p>
          <p>
            Kami mengemas kini halaman ini apabila produk berubah, dan menukar tarikh kuat kuasa di bahagian atas
            apabila kami berbuat demikian.
          </p>
        </section>
      </article>
    </main>
  );
}
