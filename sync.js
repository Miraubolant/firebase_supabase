require('dotenv').config();
const admin = require('firebase-admin');
const { createClient } = require('@supabase/supabase-js');
const cron = require('node-cron');

// Initialisation de Firebase avec l'objet de configuration
admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))
});

// Initialisation de Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const FIXED_USER_ID = process.env.USER_ID;
const db = admin.firestore();

async function syncData() {
  try {
    console.log('Début de la synchronisation:', new Date().toISOString());
    
    // Récupérer la dernière date de synchronisation
    const { data: syncData } = await supabase
      .from('sync_metadata')
      .select('last_sync')
      .eq('name', 'firebase_sync')
      .maybeSingle();
    
    const lastSync = syncData?.last_sync ? new Date(syncData.last_sync) : new Date(0);
    console.log('Dernière synchronisation:', lastSync.toISOString());
    
    // Récupérer les sessions depuis la dernière synchronisation
    const snapshot = await db.collection('current_session')
      .where('timestamp', '>', lastSync)
      .get();
    
    if (snapshot.empty) {
      console.log('Aucune nouvelle session à synchroniser');
      return;
    }
    
    console.log(`${snapshot.size} sessions à synchroniser`);
    
    // Récupérer les statistiques actuelles
    const { data: existingStats, error: fetchError } = await supabase
      .from('user_stats')
      .select('resize_count, crop_head_count, ai_count, all_processing_count, processed_images, success_count, failure_count')
      .eq('user_id', FIXED_USER_ID)
      .single();
    
    if (fetchError) {
      console.error('Erreur lors de la récupération des statistiques:', fetchError);
      return;
    }
    
    // Calculer les nouvelles valeurs
    let totalNewResizeCount = 0;
    let totalNewCropHeadCount = 0;
    let totalNewRemoveBgCount = 0;
    let totalNewProcessedImages = 0;
    
    snapshot.forEach(doc => {
      const sessionData = doc.data();
      totalNewResizeCount += (sessionData.treatments?.resize || 0);
      totalNewCropHeadCount += (sessionData.treatments?.crop_mouth || 0);
      totalNewRemoveBgCount += (sessionData.treatments?.remove_bg || 0);
      totalNewProcessedImages += (sessionData.total_images || 0);
    });
    
    // Mettre à jour les statistiques
    const statsUpdate = {
      resize_count: existingStats.resize_count + totalNewResizeCount,
      crop_head_count: existingStats.crop_head_count + totalNewCropHeadCount,
      ai_count: existingStats.ai_count + totalNewRemoveBgCount,
      all_processing_count: existingStats.all_processing_count + totalNewProcessedImages,
      processed_images: existingStats.processed_images + totalNewProcessedImages,
      success_count: existingStats.success_count + totalNewProcessedImages,
      updated_at: new Date().toISOString()
    };
    
    // Mettre à jour dans Supabase
    const { error: updateError } = await supabase
      .from('user_stats')
      .update(statsUpdate)
      .eq('user_id', FIXED_USER_ID);
    
    if (updateError) {
      console.error('Erreur lors de la mise à jour des statistiques:', updateError);
      return;
    }
    
    // Mettre à jour la date de dernière synchronisation
    const now = new Date();
    await supabase
      .from('sync_metadata')
      .upsert({
        name: 'firebase_sync',
        last_sync: now.toISOString()
      }, { onConflict: 'name' });
    
    console.log('Synchronisation réussie:', {
      sessions: snapshot.size,
      resize: totalNewResizeCount,
      crop_head: totalNewCropHeadCount,
      remove_bg: totalNewRemoveBgCount,
      total_images: totalNewProcessedImages
    });
    
  } catch (error) {
    console.error('Erreur de synchronisation:', error);
  }
}

// Exécuter une première synchronisation au démarrage
syncData();

// Définir une tâche planifiée toutes les 5 minutes
cron.schedule('*/5 * * * *', syncData);

console.log('Service de synchronisation démarré');